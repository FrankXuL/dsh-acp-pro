# 模型元数据发现：惰性 vs 立即解析的业界做法（2026-10-28）

> 触发自同一事故链：为了渲染模型选择器里的「思考档位」，本插件给**每个模型**开一个 ACP 会话（`discoverEffortsForModel`，`src/host/service/acp-agent.ts:512-536`）。
> 本文只回答一个问题：**「为每个模型物化一个会话去读档位」是业界常态还是反模式？成熟实现怎么避免？**
>
> 证据分级：`规范原文` / `一手源码`（固定 commit）/ `在线只读观测`（活接口，非固定版本）/ `本地一手源码`（本机 checkout）/ `未确认`。
> 固定版本见文末「参考源码」。凡是「协议里有这个字段」都不作为「某个 agent 会返回它」的证据，两者分开写。

## 结论摘要

1. **这是反模式，不是常态。** 调研到的四个成熟实现（OpenRouter、Anthropic、VS Code Agent Host、Zed）里，**没有一个**为「列出模型的思考档位」创建 **per-model** 的执行体（会话/进程）。档位属于**目录级元数据**：随模型列表一次性拿到（OpenRouter、Anthropic、VS Code 的 `configSchema`），或**只对当前选中模型**按需拿（Zed 的 ACP `thought_level` config option）。允许存在的执行体只有**每 provider 一个**（VS Code 枚举用的一次性 query；Zed 的会话本身）。「N 模型 → N 会话」在任何一处都没有对应物。
2. **完整的模型目录不需要每个模型的 reasoning 元数据就能渲染。** VS Code 稳定语言模型 API 的 `LanguageModelChatInformation` 里**根本没有思考档位字段**（只有 id/name/family/version/窗口/tool-image 能力）；档位是 Agent Host 在**自己的** `configSchema` 里附加的，数据来自同一次模型列表响应。也就是说「选择器要能列出模型」与「选择器要能列出档位」是两件事。
3. **档位要么随目录一起给，要么只为当前选中项算，两条路都不是 per-model 会话。** OpenRouter / Anthropic / VS Code Agent Host 走第一条：目录响应里每行自带档位（`reasoning.supported_efforts`、`capabilities.effort`、`configSchema`）。Zed 走第二条：`AgentModelInfo` **没有**档位字段，`thought_level` 是**会话配置项**，只为当前模型存在，并在 `config_option_update` 到来时重建选择器。反过来说，「列出之前先为每个模型算档位」在任何一处都不存在。
4. **协议层面，一个会话就能读全部模型的档位。** ACP 明确规定 `session/set_config_option` 的响应**必须**返回**完整**配置状态，且原文点名「如果换模型会影响可用的 reasoning 选项」——这正是「切模型后重读 `thought_level`」的规范依据。claude-agent-acp 0.97.0 与 codex-acp 都实现了这一条：切模型后重建 config options，`thought_level` 换成新模型的档位。**协议允许 + 两个主流 agent 实际支持**，是可验证的事实，不是推测。
5. **但「能返回」不等于「所有 agent 都返回」。** gemini-cli 当前**完全不发 `configOptions`**（只发旧式 `models` 数组 + `session/set_model`），也没有任何档位元数据——对它来说无论开 N 个会话还是 1 个，都读不到档位。所以「单会话循环」是**降级安全的**：读不到就是 `undefined`，不是错误。
6. **落地上有个前提：单会话探测是「写操作」，必须用专用探测会话。** 切模型会改会话状态（claude-agent-acp 还会 `query.setModel` 并按客户端能力同步 effort flag）。因此正确形态是「**1 个专用探测会话 + N 次 `set_config_option`**」，而不是复用用户正在对话的会话。
7. **DSH 自己的 ACP 服务端恰好做对了。** `packages/acp/acp/src/model-control.ts` 只对**当前选中模型**调 `resolveModelInfo`（`:196-199`），全套模型名册来自 `listModels`（零成本、无会话），并用 `serialize()` 串行化并发读写（`:136-141`）。同仓库里「服务端 = 惰性」「客户端目录 = 立即解析全部」的**不对称**，正是本次事故的根因所在，也证明惰性方案在 DSH 自己的契约内是可行的。
8. **成熟的并发/缓存原语都是现成的、可组合的**：单飞（Go `singleflight`）、并发上限（VS Code `Limiter`、`p-limit`、Zed 每模型信号量 16）、带 TTL 的 LRU（`lru-cache`、VS Code 的 code lens 缓存 LRU(20)）。本插件缺的不是机制，而是**在 `discoverEffortsForModel` 上没套用自己已在 `discoverModels` 用过的单飞**（`acp-agent.ts:502` vs `:512-536`）。

## 1. 模型选择器需要哪些元数据、何时解析

### 1.1 事实表：四个实现各自把「档位」放在哪一层

| 实现 | 档位字段所在层 | 解析时机 | 是否 per-model 执行体 |
| --- | --- | --- | --- |
| OpenRouter `/api/v1/models` | **目录响应内**，每行 `reasoning.supported_efforts` / `default_effort` | 一次 HTTP GET，列表即含档位 | 无（纯 HTTP） |
| Anthropic `/v1/models` | **目录响应内**，每行 `capabilities.effort.{low,medium,high,xhigh,max}.supported` | 一次分页 GET | 无（纯 HTTP） |
| VS Code Agent Host（Claude） | 目录行上的 `configSchema`（由该行自己的 `reasoning_effort` 列表合成） | 随模型列表一次拿全 | 无（1 个 SDK query 用于枚举，见 1.3） |
| Zed（ACP agent） | **不**在 `AgentModelInfo` 内；在会话 `configOptions` 的 `thought_level` 项 | 选中模型后，随会话配置状态 | 无（1 个 ACP 会话） |

### 1.2 OpenRouter / Anthropic：档位是目录元数据，一次 GET 拿全

`在线只读观测`（2026-10-28 实读 `https://openrouter.ai/api/v1/models`）：463 个模型中 **339 个**带 `reasoning` 块，字段为 `mandatory` / `default_enabled` / `supported_efforts` / `default_effort` / `supports_max_tokens`。单个响应即含全部模型的档位，无任何 per-model 请求。

Zed 直接消费这份目录：[`crates/open_router/src/open_router.rs#L514-L610`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/open_router/src/open_router.rs#L514-L610) 在 `list_models()` 里把每行的 `reasoning.supported_efforts` 直接搬进 `Model.supported_efforts`：

```rust
mode: if entry.supported_parameters.contains(&"reasoning".to_string()) { ModelMode::Adaptive } else { ModelMode::Default },
supported_efforts: entry.reasoning.as_ref().map(|r| r.supported_efforts.clone()).unwrap_or_default().into_iter().rev().collect(),
default_effort: entry.reasoning.as_ref().and_then(|r| r.default_effort),
```

随后 [`crates/language_models/src/provider/open_router.rs#L199-L233`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/language_models/src/provider/open_router.rs#L199-L233) 把 `Model` 投影成 `LanguageModel`，档位作为 `supported_effort_levels` 挂在模型对象上（[`crates/language_model/src/language_model.rs#L129-L131`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/language_model/src/language_model.rs#L129-L131)）。**整个链路没有任何「为某模型开一次执行」的动作。**

Anthropic 侧同样在目录里：`ModelCapabilities.effort: EffortCapability`，逐档位一个 `CapabilitySupport` —— [`anthropics/anthropic-sdk-typescript@cb5fba4 src/resources/models.ts#L111-L144`](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/models.ts#L111-L144)，`ModelInfo.capabilities.effort` 见 [`#L173-L176`](https://github.com/anthropics/anthropic-sdk-typescript/blob/cb5fba419808e3844fa6407e59577ab7ba346b79/src/resources/models.ts#L173-L176)。

**对照 OpenAI**：`/v1/models` 只给 `id` / `created` / `owned_by` / `shutdown_date` —— [`openai/openai-openapi@8b539e3 openapi.yaml#L57486-L57516`](https://github.com/openai/openai-openapi/blob/8b539e3aa2a2974574d045134903e1567e9ef81c/openapi.yaml#L57486-L57516)。档位不在目录里，但 OpenAI 也没有让客户端「每模型开一次请求」去补：客户端把 effort 当作**请求参数**（`reasoning_effort`），默认值写在自己的配置里。这是第三种合法形态：**目录不含则干脆不展示，而不是现算**。

### 1.3 VS Code：稳定 API 连档位字段都没有

`一手源码` [`microsoft/vscode@df5c887 src/vscode-dts/vscode.d.ts#L20586-L20635`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vscode-dts/vscode.d.ts#L20586-L20635)：

```ts
export interface LanguageModelChatInformation {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly tooltip?: string;
  readonly detail?: string;
  readonly version: string;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly capabilities: LanguageModelChatCapabilities;   // imageInput 等，无档位
}
```

档位是**上层自己加的**：`IAgentModelInfo` 带可选 `configSchema`，由该模型行自带的 effort 列表合成 —— [`src/vs/platform/agentHost/node/claude/claudeAgent.ts#L118-L142`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L118-L142)、[`#L174-L186`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L174-L186)，合成函数见 [`common/claudeModelConfig.ts#L93-L126`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/platform/agentHost/common/claudeModelConfig.ts#L93-L126)（注释明写：enum 来自「each model's own `reasoning_effort` list (a runtime field on CAPI's `/models` payload)」，并点名不同模型支持不同子集）。

**关键对照点**：即使 VS Code 需要「枚举 Claude 的真实模型清单」，它开的是**一个**一次性 query，调 `supportedModels()` 后立刻 `close()`，而不是每模型一个 —— [`claudeAgent.ts#L998-L1035`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L998-L1035)：

```ts
const query = await this._sdkService.query({ prompt: neverYieldingPrompt, options });
try {
  const [account, models] = await Promise.all([query.accountInfo(), query.supportedModels()]);
  ...
  return models.filter(m => !isSdkDefaultModel(m)).map(m => fromSdkModelInfo(m, this.id));
} finally { query.close(); options.abortController?.abort(); }
```

`neverYieldingPrompt` 是一个**永不 resolve** 的 prompt 迭代器——只借用控制通道，不跑 turn。这是「枚举可以借一个执行体，但**只借一个**」的教科书写法。

### 1.4 Zed：档位不进模型目录，只进当前会话的 config options

`一手源码` [`crates/acp_thread/src/connection.rs#L702-L712`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/acp_thread/src/connection.rs#L702-L712)：

```rust
pub struct AgentModelInfo {
    pub id: AgentModelId,
    pub name: SharedString,
    pub description: Option<SharedString>,
    pub icon: Option<AgentModelIcon>,
    pub is_latest: bool,
    pub cost: Option<SharedString>,
    pub disabled: Option<DisabledReason>,
}
```

没有 effort 字段。档位走另一条路：`AgentSessionConfigOptions` 的 `thought_level` 选择器，且**只为当前模型构建**。模型切换后，`config_option_update` 一到就整表重建选择器 —— [`crates/agent_ui/src/config_options.rs#L229-L243`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/config_options.rs#L229-L243)：

```rust
fn rebuild_selectors(&mut self, window: &mut Window, cx: &mut Context<Self>) {
    // Config option updates can mutate option values for existing IDs (for example,
    // reasoning levels after a model switch). Rebuild to refresh cached picker entries.
```

`thought_level` 在此只用于**键盘动作与图标**（`ToggleThinkingEffortMenu` / `CycleThinkingEffort`），见 [`#L548-L556`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/config_options.rs#L548-L556)。

**关于「打开时一次性解析全部 / 仅解析选中 / 悬停惰性」的结论**：
- OpenRouter、Anthropic、VS Code：**列表即含档位**（一次拿全，但那是目录数据，不是会话）。
- Zed + ACP：**只解析当前选中模型**的档位，其余模型在选择器中**不显示档位**。
- 「悬停时惰性解析某个模型的档位」：**未确认**，四个实现里都没找到这种交互。

## 2. 惰性解析的协议先例（LSP resolve 模式）

LSP 把「先给占位、按需 resolve」写成了**一等模式**，并在规范里直接给了性能理由。

### 2.1 `codeLens/resolve`：规范原文承认这是两阶段性能设计

`规范原文` [`microsoft/language-server-protocol@112d978 _specifications/lsp/3.19/language/codeLens.md#L88-L108`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/codeLens.md#L88-L108)：

```
 * A code lens is _unresolved_ when no command is associated to it. For
 * performance reasons the creation of a code lens and resolving should be done
 * in two stages.
```

`resolve` 请求本身见 [`#L114-L128`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/codeLens.md#L114-L128)，`data`（跨两个请求保留的句柄）见 [`#L103-L108`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/codeLens.md#L103-L108)。

### 2.2 同一个模式的四个兄弟

| 方法 | 规范原文要点 | 文件:行 |
| --- | --- | --- |
| `completionItem/resolve` | 「If computing full completion items is expensive, servers can additionally provide a handler… sent when a completion item is selected」；`resolveSupport.properties` 声明哪些属性可惰性填充 | [`completion.md#L3-L4`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/completion.md#L3-L4)、[`#L1075-L1083`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/completion.md#L1075-L1083) |
| `codeAction/resolve` | 「useful for cases where it is expensive to compute the value of a property (for example, the `edit` property)」 | [`codeAction.md#L9`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/codeAction.md#L9)、[`#L600-L612`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/codeAction.md#L600-L612) |
| `inlayHint/resolve` | 「to avoid its unnecessary computation during the `textDocument/inlayHint` request」 | [`inlayHint.md#L264-L282`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/inlayHint.md#L264-L282) |
| `documentLink/resolve` | 「The URI this link points to. If missing, a resolve request is sent later.」 | [`documentLink.md#L85-L121`](https://github.com/microsoft/language-server-protocol/blob/112d978951f2223a962bf19516637862f587bf55/_specifications/lsp/3.19/language/documentLink.md#L85-L121) |

### 2.3 客户端实现证据：只 resolve 视口内的条目

`一手源码` [`microsoft/vscode@df5c887 src/vs/editor/contrib/codelens/browser/codelensController.ts#L372-L440`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/editor/contrib/codelens/browser/codelensController.ts#L372-L440)：

- 方法名就是 `_resolveCodeLensesInViewport`——**只解析视口内的 lens**，不是全文；
- 有 250ms 去抖与移动平均自适应延迟（`:56-57`、`:431-437`）；
- 每次重算都 `cancel()` 上一次在途的 resolve（`:381-382`、`:124-125`）；
- 未带 `command` 的 lens 才发 resolve（`:410-414`）。

**与本案的同构性**：`codeLens` 列表 = 「N 个待定条目」；`codeLens/resolve` = 「按需把某个条目的昂贵字段算出来」。ACP 的 `session/new`（名册）+ `session/set_config_option`（换模型后重读档位）恰好是同构的：**名册一次拿全，昂贵字段按需/按当前项算**。区别在于 LSP 允许「只 resolve可见项」，而 ACP 若要「选择器里每个模型都显示档位」，就得对每个模型各算一次——这正是应该反问「UI 真的需要每行都显示档位吗」的地方（Zed 的答案是：不需要，只显示当前模型）。

## 3. ACP：单会话能否读全部模型的思考档位

### 3.1 协议说什么（`规范原文`）

- `session/new` 的请求参数只有 `cwd` + `mcpServers`（[`session-setup.md#L49-L64`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/docs/protocol/v1/session-setup.mdx#L49-L64)）；`configOptions` 是**响应里可选**的（`MAY`，[`session-config-options.md#L17`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/docs/protocol/v1/session-config-options.mdx#L17)）。**协议没有任何地方要求「每个模型一个会话」**。
- `session/set_config_option` 的响应**必须**是完整状态（[`#L301`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/docs/protocol/v1/session-config-options.mdx#L301)）：

  > *"The Agent **MUST** respond with the complete list of all configuration options and their current values"*

  且紧接着解释了为什么要完整（[`#L370-L375`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/docs/protocol/v1/session-config-options.mdx#L370-L375)）：

  > *"The response always contains the **complete** configuration state. This allows Agents to reflect dependent changes. For example, **if changing the model affects available reasoning options**, or if an option's available values change based on another selection."*

  **这一句就是「单会话循环切模型可读全档位」的规范依据。** schema 侧对应 `SetSessionConfigOptionResponse.configOptions` 为必填（[`schema/v1/schema.json` 的 `$defs.SetSessionConfigOptionResponse`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/schema/v1/schema.json)，Rust 定义 [`agent-client-protocol-schema/src/v1/agent.rs#L2702-L2717`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/agent-client-protocol-schema/src/v1/agent.rs#L2702-L2717)）。
- `thought_level` 只是 UX 分类，不是能力开关（[`#L219-L228`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/docs/protocol/v1/session-config-options.mdx#L219-L228)，schema 原文「It MUST NOT be required for correctness」，[`schema/v1/schema.json#L3047-L3076`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/schema/v1/schema.json#L3047-L3076)）。
- `session/set_model` **不在**当前 v1 稳定方法表里：`schema/v1/meta.json` 的 `agentMethods` 只有 `initialize/authenticate/session_{new,load,set_mode,set_config_option,prompt,cancel,list,delete,resume,close}/logout`（[`schema/v1/meta.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/92c78e809844d8c7a922ecb77f00c02b404a373a/schema/v1/meta.json)）；v1/v2 schema 中 `set_model` 命中 0 次。它是 SDK/实现层的 unstable 兼容路径（`@agentclientprotocol/sdk` 1.4.0 的 `dist/protocol.js:17` 仍把它列为 session 作用域方法，`dist/acp.d.ts` 里 Claude/Gemini 侧仍实现 `unstable_setSessionModel`）。

### 3.2 实现实际支持吗（`一手源码`，逐个核对）

**claude-agent-acp 0.97.0（`@agentclientprotocol/claude-agent-acp`）——支持，且是「切模型即重算档位」的直接实现**

- `setSessionConfigOption` 收到 `model` 值时：先 `query.setModel(...)`，再走 `applyConfigOptionValue`，最后 `return { configOptions: session.configOptions }` —— [`src/acp-agent.ts#L9302-L9311`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9302-L9311)。
- `applyConfigOptionValue` 内注释即本例的规范回响（[`#L11056`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adc2cf5d80/src/acp-agent.ts#L11056)）：

  > *"Rebuild config options since effort levels depend on the selected model."*

  随后 `session.configOptions = buildConfigOptions(...)`（[`#L11090-L11115`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L11090-L11115)），新模型的能力来自 `session.modelInfos.find(m => m.value === value)`（[`#L11029`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L11029)）。
- 档位行按**当前模型**过滤（[`src/session-effort.ts#L90-L100`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/session-effort.ts#L90-L100)）：`currentModelInfo?.supportsEffort ? (supportedEffortLevels ?? []) : []`，空列表则不产出该 option。
- `modelInfos` 本身来自**一次** `q.initializationResult()`（[`#L11975`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L11975)）——即「模型清单 + 每模型档位」是**同一个初始化响应**，agent 侧本来就在一个进程/一个 query 内拿全。

**codex-acp（`agentclientprotocol/codex-acp`）——支持，同一形态**

- `createSessionConfigOptions` 用 `currentModel?.supportedReasoningEfforts` 构造 `thought_level`（[`src/CodexAcpServer.ts#L3116-L3150`](https://github.com/agentclientprotocol/codex-acp/blob/582e545eb1868763645ea59b1a2c106e50d5d471/src/CodexAcpServer.ts#L3116-L3150)）。
- `set_config_option(model)` → `applyModelChange` → 从 `sessionState.availableModels` 找到目标模型，`applyModelAndEffort` 把 `supportedReasoningEfforts` **换成该模型的**（[`#L2750-L2800`](https://github.com/agentclientprotocol/codex-acp/blob/582e545eb1868763645ea59b1a2c106e50d5d471/src/CodexAcpServer.ts#L2750-L2800)，`setSessionConfigOption` 返回完整 `configOptions`，[`#L2664-L2678`](https://github.com/agentclientprotocol/codex-acp/blob/582e545eb1868763645ea59b1a2c106e50d5d471/src/CodexAcpServer.ts#L2664-L2678)）。
- 每模型档位数据来自 `model/list`：`Model.supportedReasoningEfforts: Array<ReasoningEffortOption>` + `defaultReasoningEffort`（[`src/app-server/v2/Model.ts#L13`](https://github.com/agentclientprotocol/codex-acp/blob/582e545eb1868763645ea59b1a2c106e50d5d471/src/app-server/v2/Model.ts#L13)），由 `fetchAvailableModels()` **分页拉一次**（[`src/CodexAcpClient.ts#L1519-L1531`](https://github.com/agentclientprotocol/codex-acp/blob/582e545eb1868763645ea59b1a2c106e50d5d471/src/CodexAcpClient.ts#L1519-L1531)），**不需要新会话**。

**gemini-cli——不支持 config options，也没有档位**

- `initialize` 只宣告 `loadSession` 与 prompt/mcp 能力，**不宣告 session config options**（[`packages/cli/src/acp/acpRpcDispatcher.ts#L91-L102`](https://github.com/google-gemini/gemini-cli/blob/363a13119a57354f469732577518b9d6b319d1d6/packages/cli/src/acp/acpRpcDispatcher.ts#L91-L102)）。
- `session/new` 只回旧式 `models: { availableModels, currentModelId }`（[`acpSessionManager.ts#L162-L177`](https://github.com/google-gemini/gemini-cli/blob/363a13119a57354f469732577518b9d6b319d1d6/packages/cli/src/acp/acpSessionManager.ts#L162-L172)）。
- 切模型是 `setModel(modelId)` → `config.setModel`（[`acpSession.ts#L244-L247`](https://github.com/google-gemini/gemini-cli/blob/363a13119a57354f469732577518b9d6b319d1d6/packages/cli/src/acp/acpSession.ts#L244-L247)，路由 [`acpRpcDispatcher.ts#L224-L236`](https://github.com/google-gemini/gemini-cli/blob/363a13119a57354f469732577518b9d6b319d1d6/packages/cli/src/acp/acpRpcDispatcher.ts#L224-L236)），**不回任何档位**。
- 整个 `packages/cli/src/acp/` 检索 `configOptions` / `thought_level` 命中 **0**。

### 3.3 因此：单会话循环是可行且降级安全的

`规范原文` 允许（完整状态必回），`一手源码` 证实两个主流 agent 会回**该模型专属**的档位，一个 agent 什么都不回但也不报错（读不到档位 → `undefined`）。**N 个会话不带来任何信息增益，只带来 N 个进程。**

**重要限定（不要把「协议允许」滑成「注入即无害」）**：

1. 切模型是**状态变更**，不是只读查询：claude-agent-acp 会 `query.setModel`，还可能在 `shouldSyncEffort` 时 `query.applyFlagSettings(...)`（[`#L11128-L11134`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L11128-L11134)）。→ 必须用**专用探测会话**，绝不能借用户正在对话的会话。
2. 若某 agent 的 `session/set_config_option` 对模型切换有副作用（持久化偏好、子进程重启），探测会话要接受这些副作用并丢弃。
3. codex-acp 对 JetBrains 2026.1 客户端临时关闭了 config options（[`#L3176-L3179`](https://github.com/agentclientprotocol/codex-acp/blob/582e545eb1868763645ea59b1a2c106e50d5d471/src/CodexAcpServer.ts#L3176-L3179)），这类按客户端关闭的开关说明**必须保留旧式 `models` + `set_model` 路径**（本插件 `acp-agent.ts:318-330` 已有）。
4. **本插件已具备全部零件**：`applyConfigOptions` 会把 `set_config_option` 响应的完整 config 折叠回 `session.efforts`（`acp-agent.ts:118-137`），`selectModel` 在 `session.models.configId !== undefined` 时正是发 `set_config_option`（`:318-330`）。因此「1 个探测会话 + 循环 `selectModel` + 每轮读 `session.efforts`」不需要新协议能力，只需把 `discoverEffortsForModel` 的**会话粒度**改成**一次会话内循环**。

## 4. 缓存与并发控制的成熟模式

### 4.1 单飞 / 请求合流（single-flight）

`一手源码` [`golang/sync@1f920df singleflight/singleflight.go#L91-L115`](https://github.com/golang/sync/blob/1f920df1e8fcf601d1aaf0f2ea500e1d2ccce105/singleflight/singleflight.go#L91-L115)：同 key 的并发调用者不重复执行，后到者 `c.wg.Wait()` 拿同一结果，并返回 `shared=true` 供调用方判断是否命中合流。注释对 `call` 的定义（`#L57-L62`）就是「in-flight or completed」。

**本插件已有的同款**：`acp-agent.ts:497-510` 的 `discoverModels` 用 `this.discovering ??= ...` + `.finally(() => { this.discovering = undefined })` 做 in-flight 合流与完成后清位。`discoverEffortsForModel`（`:512-536`）**没有**这一段——同一文件里的两个探测函数保护不对称，这是可局部修复的缺口。

### 4.2 并发上限

| 实现 | 形态 | 位置 |
| --- | --- | --- |
| VS Code `Limiter` | 以 `maxDegreeOfParalellism` 排队，`whenIdle()` 汇总 | [`src/vs/base/common/async.ts#L789-L830`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/base/common/async.ts#L789-L830) |
| `p-limit` | `activeCount < concurrency` 才 `resumeNext`，其余入队 | [`sindresorhus/p-limit@a8a6fbe index.js#L16-L62`](https://github.com/sindresorhus/p-limit/blob/a8a6fbec4e0e866d6d779b10889bb4f5567e70eb/index.js#L16-L62) |
| Zed 每模型信号量 | 同一模型的请求共享一个 `Semaphore`，默认 16 | [`crates/language_model_core/src/rate_limiter.rs#L16-L50`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/language_model_core/src/rate_limiter.rs#L16-L50) |

Zed 的 `ModelRateLimiters`（`limiters: Mutex<HashMap<LanguageModelId, RateLimiter>>`）还示范了**按 key 分桶**：限流粒度 = 模型，而不是全局。

### 4.3 LRU + TTL 元数据缓存

- `lru-cache`：`max` / `ttl` / `ttlAutopurge` 三件套，并有 `getRemainingTTL(key)` 供调用方决定是否刷新 —— [`isaacs/node-lru-cache@7e71a1f src/index.ts#L751`](https://github.com/isaacs/node-lru-cache/blob/7e71a1f3babdc68dfbadde91f28eaeea919dad9b/src/index.ts#L751)、[`#L783`](https://github.com/isaacs/node-lru-cache/blob/7e71a1f3babdc68dfbadde91f28eaeea919dad9b/src/index.ts#L783)、[`#L1595-L1600`](https://github.com/isaacs/node-lru-cache/blob/7e71a1f3babdc68dfbadde91f28eaeea919dad9b/src/index.ts#L1595-L1600)。
- VS Code 的 code lens 缓存：`LRUCache<string, CacheItem>(20, 0.75)`，键为 `model.uri`，**并按行数校验失效**（`item.lineCount === model.getLineCount()` 才命中）—— [`src/vs/editor/contrib/codelens/browser/codeLensCache.ts#L50`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/editor/contrib/codelens/browser/codeLensCache.ts#L50)、[`#L70-L79`](https://github.com/microsoft/vscode/blob/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5/src/vs/editor/contrib/codelens/browser/codeLensCache.ts#L70-L79)。这是「缓存昂贵派生值 + 廉价版本校验」的范式。
- Zed 的 OpenRouter provider 有显式 `refresh_models()`（[`crates/language_models/src/provider/open_router.rs#L353-L356`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/language_models/src/provider/open_router.rs#L353-L356)），即「目录缓存 + 用户可触发刷新」，而不是每次读都重算。

**对本案的映射**：`discoverEffortsForModel` 已有 per-key 缓存（`generation|cwd|model`），但 (a) 无 in-flight 合流、(b) 无 TTL（agent 升级/切换 provider 后陈旧档位只能靠 `generation` 清）、(c) 缓存的是「每个模型一条」而不是「一次探测拿到的整张表」。最省的形态是：**一次单飞探测 → 一张 `model → efforts` 表 → 进缓存**，后续所有 `resolveModelInfo` 都是查表。

## 5. DSH 自身 ACP 服务端的对照

`本地一手源码`（`deepseek-harness@687f282`，包 `@deepseek-ai/dsh-acp@0.2.1-rc.2`）。**结论先行：DSH 作为 ACP 服务端没有犯同样的错误，它给出的正是「名册廉价、精确元数据惰性」的接口。**

### 5.1 `model-control.ts`：名册用 `listModels`，档位只为当前模型解析

`packages/acp/acp/src/model-control.ts:144-221` 的 `state()` 分红明确：

1. **先解析当前选择**（`:150`，`resolveSelection(selected)`）。
2. **名册：把每个 provider 的每个模型都列出来，但只取 id/name/description**（`:158-177`）：

   ```ts
   const groups = await Promise.all(this.llm.listProviders().map(async (provider) => {
     const models = await this.llm.listModels(provider.id)
     const entries = models.map((model) => { ... name, description ... })   // 无 reasoning
   ```

   **`listModels` 是纯目录读取，不产生任何会话/进程。**
3. **档位：只对当前模型 `resolveModelInfo`**（`:196-199`）：

   ```ts
   const info = routeAvailable
     ? await this.llm.resolveModelInfo(resolved.provider, resolved.model, signal)
     : undefined
   ```

   并且仅在 `info.reasoning !== undefined` 时才产生 `category: 'thought_level'` 的 option（`:199-219`），值来自 `info.reasoning.efforts`。

4. **并发安全：所有读改写都过一道 `serialize()` 串行队列**（`:136-141`）：

   ```ts
   private serialize<T>(operation: () => Promise<T>): Promise<T> {
     const result = this.tail.then(operation)
     this.tail = result.then(() => undefined, () => undefined)
     return result
   }
   ```

   `options()`（`:92-94`）与 `set()`（`:103-134`）都走它——这正是「同一会话上的探测必须串行」的正确做法，而本插件用**并发开会话**绕开了这个问题。

5. **换模型时的档位刷新是「重算当前模型」**（`set()` 的 `MODEL_CONFIG_ID` 分支，`:108-113`）：先 `state()` 取 `choices`，再 `resolveSelection` 校验新 route，然后 `return (await this.state(signal)).options`（`:132`）——**完整快照重算，仍然是 1 个 `resolveModelInfo`，0 个新会话**。

### 5.2 `content.ts`：只管内容准入，不碰模型名册

`packages/acp/acp/src/content.ts` 与模型元数据无关，唯二两处 `resolveModelInfo` 都是**当前 route**的 image 能力判定：

- `assertImageRoute()`（`content.ts:62-79`）：只为**当前 route**校验 `inputModalities` 是否含 `image`，失败即 `invalid`；
- `supportsAcpImagePrompts()`（`content.ts:89-104`）：`initialize` 时判定是否宣告 inline image，同样只解析**部署配置的那一个** `provider/model`。

**没有**任何「遍历模型」「为模型开会话」的逻辑。这一点值得直接对照：DSH 服务端在最需要元数据的地方（`initialize` 的能力宣告）也是「只问当前那一个」。

### 5.3 服务端是怎么把档位送出去的

`packages/acp/acp/src/index.ts`：

- `newSession` 返回 `{ sessionId, configOptions }`（`:229-235`，`configOptions = await record.configOptions(signal)`）；
- `session/resume` 同样返回 `{ configOptions }`（`:285-288`）；
- `session/set_config_option` → `record.setConfig(...)` → `{ configOptions }`（`:337-349`）；
- 拓扑变化时主动推 `config_option_update`（`session.ts:214-237`）。

**即：服务端把「每个模型的档位」表达成「当前模型的 config option + 切模型后重发完整快照」，这正是 §3.3 所要求的形态。** 客户端拿这些 option 就能渲染档位选择器，无需任何 per-model 会话。

### 5.4 同一仓库里的不对称：这才是根因

| 位置 | 角色 | 档位解析粒度 | 会话/进程成本 |
| --- | --- | --- | --- |
| `packages/acp/acp/src/model-control.ts:196-199` | ACP **服务端** | 仅当前模型 | 0（会话已存在） |
| `packages/api/session-controller/src/catalog.ts:25-29` | GUI 目录 **投影** | **全部模型**（`Promise.all` 每个 model 一次 `resolveModelInfo`） | 客户端注入；ACP 侧被放大成 N 会话 |

`catalog.ts` 的 `entries = await Promise.all(models.map(async (model) => { const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id) ...}))`（`:28-29`）本身只是「目录里带上 reasoning」的产品选择；它对 adapter 的契约是 `resolveModelInfo(provider, model)` **一次一个模型**，不带任何并发约定。于是「catalog 想要每行都有档位」被 adapter 实现成了「每行都开一个外部会话」。

**对照结论**：DSH 服务端的接口证明「惰性解析当前模型」在 DSH 自己的 `LlmRuntime` 契约内完全可行；问题不在 `resolveModelInfo` 的粒度，而在 adapter 把「一次精确解析」实现成了「一个会话」。既然 `resolveModelInfo` 是逐模型的、可被并发调用，正确做法是在 **adapter 内**把「N 次精确解析」合流成「1 个探测会话 + N 次 `set_config_option`」，再加单飞与并发上限——**对 `catalog.ts` 零改动**。

## 参考源码（固定 commit）

| 项目 | 固定版本 | 本文引用的路径 |
| --- | --- | --- |
| ACP 规范/ schema | [`agentclientprotocol/agent-client-protocol@92c78e8`](https://github.com/agentclientprotocol/agent-client-protocol/tree/92c78e809844d8c7a922ecb77f00c02b404a373a)（2026-10-27） | `docs/protocol/v1/session-config-options.mdx`、`docs/protocol/v1/session-setup.mdx`、`schema/v1/schema.json`、`schema/v1/meta.json`、`agent-client-protocol-schema/src/v1/agent.rs` |
| claude-agent-acp | [`@059d76e`](https://github.com/agentclientprotocol/claude-agent-acp/tree/059d76e14a20e533846954c64ac5adcda2cf5d80)（v0.97.0） | `src/acp-agent.ts`、`src/session-effort.ts`、`src/session-config-ids.ts` |
| claude-code-acp（事故现场版本 0.16.1，仓库后改名 claude-agent-acp） | [`agentclientprotocol/claude-agent-acp@e2a1ac9`](https://github.com/agentclientprotocol/claude-agent-acp/tree/e2a1ac9b9d8ca5d1c9d401c4fa724a8f3f871ad5)（npm `@zed-industries/claude-code-acp@0.16.1` 的 `gitHead`） | `src/acp-agent.ts`（`configOptions` 命中 0，`sessionCapabilities.close` 缺失） |
| codex-acp | [`@582e545`](https://github.com/agentclientprotocol/codex-acp/tree/582e545eb1868763645ea59b1a2c106e50d5d471)（2026-10-27） | `src/CodexAcpServer.ts`、`src/CodexAcpClient.ts`、`src/ModelConfigOption.ts`、`src/app-server/v2/Model.ts` |
| gemini-cli | [`@363a131`](https://github.com/google-gemini/gemini-cli/tree/363a13119a57354f469732577518b9d6b319d1d6)（2026-10-26） | `packages/cli/src/acp/{acpRpcDispatcher,acpSessionManager,acpSession}.ts` |
| Zed | [`@37faef8`](https://github.com/zed-industries/zed/tree/37faef81f74fc1bb08be9939c4cffc8ede6ced2f)（2026-10-27） | `crates/acp_thread/src/connection.rs`、`crates/agent_ui/src/config_options.rs`、`crates/agent_servers/src/acp/v1.rs`、`crates/open_router/src/open_router.rs`、`crates/language_models/src/provider/open_router.rs`、`crates/language_model/src/language_model.rs`、`crates/language_model_core/src/rate_limiter.rs` |
| VS Code | [`@df5c887`](https://github.com/microsoft/vscode/tree/df5c887e7961d1294c7a2456aba8a4e58e4bfcb5)（2026-10-27） | `src/vscode-dts/vscode.d.ts`、`src/vs/platform/agentHost/node/claude/claudeAgent.ts`、`common/claudeModelConfig.ts`、`common/reasoningEffort.ts`、`src/vs/editor/contrib/codelens/browser/{codelensController,codeLensCache}.ts`、`src/vs/base/common/async.ts` |
| LSP 规范 | [`microsoft/language-server-protocol@112d978`](https://github.com/microsoft/language-server-protocol/tree/112d978951f2223a962bf19516637862f587bf55)（2026-10-27） | `_specifications/lsp/3.19/language/{codeLens,completion,codeAction,inlayHint,documentLink}.md` |
| OpenAI OpenAPI | [`openai/openai-openapi@8b539e3`](https://github.com/openai/openai-openapi/tree/8b539e3aa2a2974574d045134903e1567e9ef81c)（2026-10-27） | `openapi.yaml`（`/models`、`Model` schema） |
| Anthropic TS SDK | [`anthropics/anthropic-sdk-typescript@cb5fba4`](https://github.com/anthropics/anthropic-sdk-typescript/tree/cb5fba419808e3844fa6407e59577ab7ba346b79) | `src/resources/models.ts` |
| Go singleflight | [`golang/sync@1f920df`](https://github.com/golang/sync/tree/1f920df1e8fcf601d1aaf0f2ea500e1d2ccce105) | `singleflight/singleflight.go` |
| p-limit | [`sindresorhus/p-limit@a8a6fbe`](https://github.com/sindresorhus/p-limit/tree/a8a6fbec4e0e866d6d779b10889bb4f5567e70eb) | `index.js` |
| lru-cache | [`isaacs/node-lru-cache@7e71a1f`](https://github.com/isaacs/node-lru-cache/tree/7e71a1f3babdc68dfbadde91f28eaeea919dad9b) | `src/index.ts` |
| DSH（服务端与目录投影） | [`deepseek-ai/deepseek-harness@687f282`](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317)（0.2.1-rc.2） | `packages/acp/acp/src/{model-control,content,session,index}.ts`、`packages/api/session-controller/src/catalog.ts` |
| 本插件（事故点） | 本仓库 `36b8231` 工作树 | `src/host/service/acp-agent.ts`、`src/host/service/acp-adapter.ts` |

**未确认项**（明确记录，未编造）：

1. OpenRouter `/api/v1/models` 的 `reasoning` 块**没有**对应的固定 schema 版本（官方文档页未给字段级 schema）；本文只记录 2026-10-28 的活接口读数与 Zed 的解析代码，未把它当作稳定契约。
2. Zed 是否对「非当前模型」做悬停/预取式档位解析：**未确认**（代码中未见，且 `AgentModelInfo` 无档位字段，倾向「不做」）。
3. 各 agent 的 `thought_level` 档位是否**真正生效**（即 `set_config_option` 后推理行为确实改变）：本文只核对「返回了该模型专属的档位列表」，未做端到端行为验证；`docs/design/acp-reference-research-2026-10.md` 已记录过「协议/schema 出现 ≠ 实际生效」的先例。
4. gemini-cli 是否在未合并分支上已加 config options：只核对固定 commit `363a131`，未跟踪各 PR。
