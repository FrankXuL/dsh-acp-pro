# ACP 记录 → 原生轨迹可见性：可执行契约

- 调研日期：2026-10-28
- 工单类型：wayfinder research
- 仓库（被约束方）：`/Users/xulilili/Downloads/dev/code/dsh-acp-pro`
- 上游一手源码：`/Users/xulilili/Downloads/闲聊/deepseek-harness`，版本 `0.2.1-rc.2`，commit `687f282e`
- 运行版：`0.2.1-rc.3`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）

> **版本免责**：本文所有 `file:line` 均引自 rc.2 源码。凡结论可能受 rc.3 影响处标注「rc.2 源码，未在 rc.3 复核」。截至本文完成，未对 rc.3 打包件做逐行比对，因此**任何进入实施的判断都应在 rc.3 上复核一遍**（尤其是第 1 节封闭 union 与第 3 节导出面）。

---

## 0. 结论速览（三档）

| 档位 | 判定 | 一句话 |
| --- | --- | --- |
| **可做** | 让 ACP 工具调用/计划/权限出现在轨迹视图 | 可行，且**不违反** AGENTS.md「禁止伪造原生 `tool/call` / `tool/result`」——路径是新增 `target: 'trajectory'` 的 Definition，`kind: 'node'` 承载一个 `'unknown'`-形状节点，**不写入任何 `tool/call` 事件** |
| **不可做** | 插件自带新的 contribution kind | 不可行。`TrajectoryContribution` 是**封闭 union**（8 个字面量 kind），且 `ui-trajectory` 未把 `trajectoryNode` 纳入导出面 |
| **不可做** | 一个 Definition 同时服务 `chat` + `trajectory` | 不可行。契约明写 `target` 是 Definition **独占**的单一 target（`Sole view target`） |
| **需要上游** | 在轨迹里做出「和原生工具卡一模一样」的 `schema` / `usage` / `options` tab | 需要上游先提供 `callSchemas` 注入点或允许插件注册新的 `<DetailTab>`；当前 `DetailTab` 也是封闭 union |

**核心一句话**：能做，但只能做到「在轨迹里出现一条可展开的、诚实标注为外部 ACP 的记录」，做不到「伪装成原生 tool 卡」；**必须新建 3 个 `target: 'trajectory'` 的 Definition**（与现有 3 个 `target: 'chat'` 的 Definition 一一镜像），`target` 值为字符串字面量 `'trajectory'`。

---

## 1. Q1 — `TrajectoryContribution` 是否封闭？builder 只消费哪几种 kind？

### 1.1 封闭 union（确认：封闭）

`packages/client/ui-trajectory/src/client/trajectory-contract.ts:23-58` 定义 `TrajectoryContribution`，8 个字面量成员：

- `:24` `kind: 'system-prompt'` — 带 `prompt: SystemPromptNode`
- `:25-28` `kind: 'node'` — 带 `node: ConversationNode`
- `:29-34` `kind: 'assistant'` — `node?` / `partial` / `request?`
- `:35-38` `kind: 'tool'` — 带 `root: ToolCallBlock`
- `:39-42` `kind: 'request-header'` — 带 `header: TrajectoryRequestHeaderState`
- `:43-46` `kind: 'compaction'` — 带 `request: Extract<RequestView, { purpose: 'compaction' }>`
- `:47-51` `kind: 'session-end'` — `seq` + `time`
- `:52-58` `kind: 'turn-end'` — `turn` + `time` + 可选 `error` / `errorCode`

这是一个 TypeScript 字面量联合，**没有 `| { kind: string }` 兜底成员，也没有 declaration-merge 扩展点**。对比同文件 `:83-88` 的 `ConversationViewSnapshotMap`（`declare module` 可 merge）与 `:90-104` 的 `SlotMap`（可 merge）——**contribution kind 恰恰是唯一没有 merge 扩展的**。

**判定：插件无法注册自己的新 contribution kind。** 若插件在自己的代码里构造 `{ kind: 'acp-tool' }` 并塞进 `target: 'trajectory'` 的节点，builder 的 `snapshot()` 循环会静默丢弃它（见 1.3）。

> rc.2 源码，未在 rc.3 复核。

### 1.2 builder 消费的 kind（确认：全部 8 种，但有两种只影响标量）

`packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts:222-275` 是唯一消费处：

| kind | 行号 | 去向 |
| --- | --- | --- |
| `system-prompt` | `:224-227` | `systemPrompts[]`（若未被 request-header 代表） |
| `request-header` | `:228-232` | 更新 `previousHeader` / `previousTools`，**不产出 eventNodes** |
| **`node`** | `:233-237` | **`finalized.push(data.node)`** + `eventLocations.set(node.seq, location)` |
| `assistant` | `:238-252` | `finalized.push(node)` / `partial` / `requests.push` |
| **`tool`** | `:253-260` | `'kind' in root ? finalized.push(root) : runningCalls.push(root)` |
| `compaction` | `:261-264` | `requests.push` |
| `session-end` | `:265-268` | `boundaries.push` |
| `turn-end`（兜底分支） | `:269-274` | `turnEndings.push` |

注意 `:269` 是裸 `turnEndings.push(...)`，**没有 `else`**——它是最后一个分支，任何不匹配上述 kind 的 payload 会继续往下走到这里，读取 `data.turn`（`undefined`），被塞进 `turnEndings` 后由 `applyTurnErrors`（`:126-148`）用 `ending.error === undefined` 早退过滤掉。**即：未知 kind 不会崩，但会被彻底忽略。**

### 1.3 「进轨迹」的唯一现有通道：`kind: 'node'`

`:233-237` 是唯一把**外部可构造**对象放进 `eventNodes` 的路径。`kind: 'tool'` 需要 `ToolCallBlock`（`StartedToolCall | ToolResultNode`），两者的 `args` 字段类型是 `ToolArgs`，而 `ToolArgs = PartialArguments` 是 `@deepseek-ai/dsh-util-values` 的一个**类实例**（`packages/util/values/src/partial-json.ts:76`，`static fromText` 在 `:85`）。

- `@deepseek-ai/dsh-util-values` 在本插件 `node_modules/@deepseek-ai/` 下**不存在**（`ls` 无该条目），`require.resolve` 返回 `MODULE_NOT_FOUND`；
- 该包 `package.json` 的 `exports` 只有 `"."` 与 `"./src/*"`，**没有 `./client` 子路径，也没有 `dsh` 字段**（`node -e` 读 `p.dsh` 为 `undefined`）——即它不是一个 client 模块表行。

因此走 `kind: 'tool'` 需要（a）新增依赖 + （b）确认它能进客户端 module table，成本与风险都高于 `kind: 'node'`。**结论：ACP 记录应映射为 `kind: 'node'`。** 具体节点形状见第 5 节。

> rc.2 源码，未在 rc.3 复核。

---

## 2. Q2 — `trajectoryNode` 能否从外部包导入？

### 2.1 它是内部文件，不是导出符号

`trajectoryNode` 定义在 `packages/client/ui-trajectory/src/client/trajectory-definition-common.ts:14-28`，是一个**普通具名导出**（供同包内 5 个文件使用：`trajectory-assistant-definition.ts:10`、`trajectory-message-definitions.ts:7`、`trajectory-tool-definition.ts:8`、`trajectory-compaction-definition.ts:6`、`trajectory-request-header-definition.ts:5`）。

但它**没有**出现在包的公开 barrel：`packages/client/ui-trajectory/src/client/index.ts:31-38` 只导出类型（`TrajectoryKey`、`TrajectoryContribution`、`TrajectoryConversationViewNode`、`TrajectoryRequestHeaderState`、`TrajectorySnapshot`、`UseTrajectory`），加上 `inject`（`:41`）与 `apply`（`:48`）。**没有任何值导出。**

对照 `lib/types/client/index.d.ts`（构建产物 `.d.ts`）确认：只有 3 个 `export type { ... }`、`inject`、`apply`。

### 2.2 package.json exports 不足以穿透

`packages/client/ui-trajectory/package.json`：

- `:21-24` `"./client"` → `./lib/types/client/index.d.ts` / `./lib/client.js`（**这是唯一可用的公开入口，不含 `trajectoryNode`**）
- `:25` `"./src/*": "./src/*"` ← 这条**看起来**允许 `@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-definition-common.ts`
- `:73-78` `files` 字段**不含 `src`**（只有 `locale/*.json`、`lib/index.js`、`lib/client.js`、`lib/types/**/*.d.ts`）

即：`./src/*` 在**本仓库 workspace 内**可用（源码就在盘上），但在**发布/安装形态**下 `src` 不会被发布，该子路径会解析失败。对本插件而言，两种形态都不可靠。

### 2.3 运行时（客户端 module table）也不可达

更硬的约束在运行时。本插件的 client 产物是 CJS，靠 DSH 的 `window.__ModuleLoader__` 模块表解析外部依赖（`tsdown.config.ts:7` `CLIENT_SEEDS = ['react', 'react/jsx-runtime', /^@deepseek-ai\//]`，`:37-39` `neverBundle: CLIENT_SEEDS`）。解析逻辑在 `packages/client/modules/src/client/system.ts:330-337`：

```
if (this.factories.has(id)) return this.materialize(id).exports
throw new Error(`client-modules: require("${spec}") missed the module table — not a platform seed word, ...`)
```

而 `stripClientSuffix`（`packages/client/modules/src/client/manifest.ts:218-220`）只剥 `/client` 后缀。因此 `require('@deepseek-ai/dsh-client-ui-trajectory/client')` 能解析到该包的 client 行，但**取回的 `exports` 里没有 `trajectoryNode`**；`require('@deepseek-ai/dsh-client-ui-trajectory/src/client/trajectory-definition-common.ts')` 剥不出 `/client`，落成另一个 id，模块表里没有该行 → 直接 `throw`。

另外本插件 `node_modules/@deepseek-ai/` 里**没有 `dsh-client-ui-trajectory` 符号链接**（`ls` 无该条目，`require.resolve('@deepseek-ai/dsh-client-ui-trajectory/client')` → `MODULE_NOT_FOUND`），`package.json` 也未把该包列入 `dsh.client.inject`（`package.json:43-52`）。

**判定：不可从外部包导入 `trajectoryNode`。** 插件必须自己构造等价信封。

### 2.4 信封极简，自行构造成本极低（好消息）

`trajectory-definition-common.ts:19-28` 全文只有 10 行赋值：

```ts
{
  key: context.key,
  kind: context.kind,
  id: context.id,
  target: 'trajectory',
  anchorSeq,
  location: context.start?.location ?? { kind: 'unresolved' },
  data,
}
```

这是**唯一**的引擎侧要求，且 assembler 只做两项校验（`packages/client/ui-conversation/src/client/conversation/assembler.ts:906-915`）：`node.key` 必须等于 `context.key`，`node.target` 必须等于正在构建的 target。**插件自行展开这 7 个字段即可，无需该包。**

> rc.2 源码，未在 rc.3 复核。

---

## 3. Q3 — Definition 注册契约：`target` 是自由字符串吗？能否多 target？

### 3.1 `target` 是自由 `string`，不是封闭联合（但语义是"独占"）

`packages/client/ui-conversation/src/client/contract/conversation.ts`：

- `:213-216` `ConversationNodeDefinition.target?: string`，注释原文：**`Sole view target owned by this Definition; omitted for state-only Contexts.`**
- `:317-318` `ConversationViewDefinition.target: string`

两处都是**开放 `string`**，没有任何字面量联合或 `keyof ConversationViewSnapshotMap` 约束。`ViewState.target` 亦为 `string`（`assembler.ts:1074`）。

**「Sole」是可验证的行为约束而非类型约束**：`assembler.buildNode`（`:906-908`）以 `if (context.definition.target !== target ...) return null` 做单值比对 —— 一个 Definition 只能落在一个 target 上。若想同时服务两个 target，只能注册两份 Definition（不同 `kind`，见 3.4 的 kind 唯一性）。

### 3.2 `target` 与 `buildViewNode` 必须成对

`packages/client/ui-conversation/src/client/conversation/event-registry.ts:111-117`：

```ts
if ((definition.target === undefined) !== (definition.buildViewNode === undefined)) {
  throw new Error(`conversation Definition "${definition.kind}" must declare target and buildViewNode together`)
}
```

即：`target: 'trajectory'` 必须配 `buildViewNode`；不想要 view 就两个都不写（state-only）。

### 3.3 view target 必须先注册 builder

`assembler.ts:1083` `this.views.set(definition.target, view)` 的 `views` 集合来自 `views.register(...)`（`view-registry.ts:8-16`，重复 target 直接抛 `conversation view target "..." is already registered`）。

对 `'trajectory'` 而言，builder 由**上游 `ui-trajectory` 包**注册（`trajectory-snapshot-builder.ts:303-311` 的 `trajectoryViewDefinition`，`registerTrajectoryConversationView` 在 `:318-320`，经 `index.ts:74` 调用）。**插件不得重复注册 `target: 'trajectory'` 的 view**——那会抛错。插件只注册 **event Definition**，复用上游已有的 `'trajectory'` builder。

这也意味着：轨迹视图在用户切到该 tab 时才激活（`assembly.ts:48-50` 的 `activate()` 语义：首个 subscriber 激活，之后生命周期内保持；`assembler.ts:740` `if (target === undefined || !this.activeTargets.has(target)) return` 未激活则不标脏）。**未激活不影响正确性，只影响即时性**——切换 tab 时会走 `replaceView` 全量重建。

### 3.4 `claim`（`exclusive`）语义：同 target 内互斥，跨 target 互不干扰

`conversation.ts:11-20`（原文）：

- `exclusive?: true` 表示"在**该 Definition 的 target** 上认领此事件"：**同一 target** 的其他 Definition 收不到，该 target 的 unmatched fallback 也不跑；
- **其他 target 的 Definition、以及无 target 的 Definition 仍然收到**；
- 同一 target 上两个 claim → dispatch 期抛错；无 target 的 Definition 返回 claim → 抛错；
- fallback 自己返回的 claim 无效（fallback 只在无匹配时才跑）。

实现见 `assembler.ts:519-533`：`claims` 是 `Map<target, definitionKind>`，`:530-532` 两个 Definition 抢同一 target → `throw`；`:536` `if (target !== undefined && result.exclusive !== true && claims?.has(target) === true) continue` 实现同一 target 内的压制。

**对本工单的可执行结论**：`plugin:acp/*` 事件目前被 `target: 'chat'` 的三个 Definition 匹配（`src/client/conversation/records.ts:93-98 / 120-125 / 151-156`），且它们**未返回 `exclusive`**。因此同事件**可以**再被 `target: 'trajectory'` 的新 Definition 匹配——两条路径并行，互不压制，无需改动现有 chat Definition。若 ACP 想独占这些事件不让 chat 也渲染，则需在 chat 侧加 `exclusive: true`，但同一 target 内只能有一个 claim，且 `exclusive` 不会跨 target 生效。

### 3.5 `inspect` 语义（问题中的 `ConversationViewNodeRegistration` 不存在）

**未找到证据**：全 harness 搜索 `ConversationViewNodeRegistration` 无任何命中（`grep -rn` 覆盖 `packages/`，排除 node_modules，0 结果）。问题中的该类型名疑为误记。

实际相关的是一个**方法**而非注册类型：`ConversationViewDefinition.toolCallFocus?`（`conversation.ts:319-324`），注释 `Address a tool call in this target's inspector; absent for non-inspection views.`

链接机制在 `packages/client/ui-conversation/src/client/apply.ts:394-401`：

```ts
const inspectionTarget = () => uiConversation.views.entries().find(definition =>
  definition.toolCallFocus !== undefined
  && conversationViews.getSnapshot().some(view => view.id === definition.target))
const inspectCall = (callId: string): void => {
  const target = inspectionTarget()
  if (target?.toolCallFocus !== undefined) openView(target.target, target.toolCallFocus(callId))
}
```

即：`inspectCall` 取**第一个**声明了 `toolCallFocus` 且其 view tab 当前可见的 target，然后用该 target 的 `toolCallFocus(callId)` 生成 focus 串再 `openView`。`'trajectory'` builder 已声明 `toolCallFocus: callId => callId`（`trajectory-snapshot-builder.ts:309`）。

**对本工单的影响**：如果 ACP 在轨迹里渲染工具记录，最好让它也能被 `inspectCall` 定位。但 `inspectCall` 是"第一个可见的 inspection target"——轨迹与 chat 谁先注册取决于 view 顺序（`ui-trajectory/src/client/index.ts:83` `order: 10`），插件无法可靠指定。**这是需要上游考虑的优先级问题，不应由插件猜测。**

---

## 4. Q4 — `ConversationNodeContext` 字段；记录要满足什么才能被某 target 认领？

### 4.1 字段全表

`conversation.ts:167-176`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 引擎生成的 Context key（`conversationContextKey(kind, id)`，`:341-343`）；`buildViewNode` 返回的 `key` **必须**等于它 |
| `kind` | `string` | Definition 的 `kind` |
| `id` | `string` | `match()` 返回的 Definition 内业务身份 |
| `matches` | `readonly ConversationMatch[]` | 已接受的事件序列（含 role 与已解析 `location`） |
| `start` | `ConversationStartMatch \| undefined` | 最早 in-window 的 start |
| `state` | `State \| undefined` | `start`/`update` 折叠出的状态 |
| `current` | `ReadonlyMap<string, ConversationViewNode \| null>` | 各 target 已物化节点 |

注：`update()` 收到的是 `ConversationNodeContext<State> & { state: State }`（`:241-244`），`start()` 额外拿 `reader: ConversationContextReader`（`ConversationNodeContext` 本身**不含** `reader` / `previous`）。

### 4.2 被某 target「认领」的充分条件

1. **`Definition.target === 该 target`**（`assembler.ts:906`）——字符串相等，无其他规则；
2. **`Definition.buildViewNode !== undefined`**（同上，且 `event-registry.ts:111-117` 强制与 `target` 成对）；
3. **`match(event)` 对该事件返回非 `null`**（`assembler.ts:519` 附近先跑 match，再解析 claims）；
4. **不是同 target 上已被 `exclusive` claim 的事件**（`assembler.ts:536`）；
5. 可选：该 target 的 `fallback` 不参与竞争（`ui-chat` 注册了唯一 fallback，`packages/client/ui-chat/src/client/conversation-nodes/fallback.ts:40`；`event-registry.ts:42-43` 要求 fallback 有 target 且全局唯一）。

### 4.3 ACP 记录当前满足什么

`src/client/conversation/records.ts:90-114 / 117-141 / 148-172` 三个 Definition 均满足 1-4（`target: 'chat'` + 有 `buildViewNode`），且 `match` 走 `match: (event) => ...` 函数形式。`kind` 分别为 `'acp-tool-call'` / `'acp-plan'` / `'acp-permission'`。

**注意 `kind` 的唯一性约束**：`definition-registry.ts:49` `if (this.definitions.has(key)) throw new Error(duplicateMessage)` —— 同一 registry 内 `kind` 不可重复。因此**新增的 trajectory Definition 必须使用不同的 `kind`**（建议 `'acp-tool-call@trajectory'` 之类，或任意不冲突命名；详见第 8 节）。

---

## 5. Q5 — `ConversationNode` 形状；`TrajectoryTable` 的 DetailTab 取数；ACP 的降级

### 5.1 `ConversationNode` 也是封闭 union，但有 `'unknown'` 兜底成员

`packages/client/ui-conversation/src/client/contract/records.ts:257-268`：

`UserMessageNode | AssistantMessageNode | SteeringMessageNode | ContextMessageNode | ModelRetryNode | TurnErrorNode | TurnMaxTokensNode | ToolResultNode | CommandNode | CompactionSummaryNode | UnknownSurfaceNode`

其中 `UnknownSurfaceNode`（`:209-221`）**就是为"不认识的 append-surface 事件"准备的通用兜底**：

```ts
interface UnknownSurfaceNode {
  kind: 'unknown'
  seq: number
  time: number
  type: string
  data: unknown
}
```

它的文档（`:209-213`）明确写着：*Fallback for unclaimed append-surface events. The merge-extensible SessionEventMap permits unfamiliar events to retain a raw presentation.*

### 5.2 任意外部节点的硬性要求（决定"会不会崩"）

`ui-trajectory` 的 fold 在 `layout.ts:402-505`，按 `node.kind` 逐个 `if` 分发，**末尾没有 `else`**（`:505` 直接结束 `for` 循环体）。已处理：`user`(:403)、`steering`(:419)、`assistant`(:439)、`context`(:452)、`compaction`(:465)、`tool-result`(:471)。

**崩溃分析结论：** 一个 `kind: 'unknown'` 的节点进入 `eventNodes` 后，**不会命中任何一个分支，被静默丢弃，不崩不抛**。它仍会参与若干辅助索引（`:992` 只索引 `tool-result`；`:1000` 只索引 `assistant`），因此对布局无副作用。

但"不崩"不等于"可见"。要**可见**，该节点必须被 fold 认成某一种已处理 kind。**唯一无需伪造事件、且不需要 `ToolArgs` 类实例的可见形态是 `tool-result`**——但要满足 `ToolResultNode` 全部必填字段（`records.ts:161-183`）：

| 字段 | 类型 | ACP 能否如实提供 |
| --- | --- | --- |
| `kind` | `'tool-result'` | 是（受约束见 5.3 风险） |
| `seq` | `number` | 是（记录事件的 seq） |
| `time` | `number` | 是（`updatedAt`） |
| `callId` | `string` | 是（`runId:callId`） |
| `name` | `string` | 是（`title`） |
| `args` | `ToolArgs` | **否**（需要 `PartialArguments` 实例，见 1.3） |
| `call` | `{ name, argsRaw } \| null` | 是（`{ name: title, argsRaw: input ?? '' }`） |
| `callTime` | `number \| null` | 是（`startedAt`） |
| `content` | `readonly ContentBlock[]` | 部分（ACP `AcpToolContentView` 需转成 `ContentBlock`；text 可直传，diff/image/link/terminal 需降级为 text） |
| `isError` | `boolean` | 是（`status === 'failed'`） |
| `subCalls` | `readonly ToolCallBlock[]` | 是（`[]`） |
| `error?` / `meta?` / `parentCallId?` | 可选 | 可省 |

`args` 是**类型层面的必填**。运行时是否被读？检索 `layout.ts` 与 `TrajectoryTable.tsx`：`node.args` **没有任何直接读取**（`grep '\.args\b'` 只命中 `TrajectoryTable.tsx:1093 / 1121-1123` 的 `toolCallText.args`，那是从 `cell.previewMarkdown`/`inputDetail` 派生的展示文本，不是 `node.args`）。`summarizeCall`（`layout.ts:1093-1102`）只用 `name` 与 `argsRaw`。

**因此实践上：`args` 需要一个 `PartialArguments` 形状的对象，但若插件以 `as unknown as ToolArgs` 塞入 `PartialArguments.fromText(input)` 的等价物（甚至 `{}`），轨迹渲染不会读它。** 但这是**类型逃逸**，属于技术债，必须在实施票里显式标注，且优先考虑向 `ui-trajectory` 上游申请放宽（见第 6 节「需要上游」）。

### 5.3 DetailTab 定义与取数来源

`DetailTab` 也是**封闭 union**：`TrajectoryTable.tsx:170-183`，13 个成员（`system-prompt` / `tools` / `overview` / `rendered` / `raw` / `source` / `input` / `output` / `schema` / `options` / `usage` / `timing` / `diff`）。

可用 tab 由 `detailTabs(record: TableRecord)`（`:976-1011`）按 `cell.kind` 计算。对工具类记录（非 system/compacted/markdown 的兜底分支，`:1001-1010`）：

| tab | 取数字段 | 位置 | ACP 只有 raw input/output 时 |
| --- | --- | --- | --- |
| `overview` | 汇总 | `:1002` | 总是可用 |
| `input` | `cell.inputDetail`（`record.cell.inputDetail ? [...] : []`，`:1003-1005`） | ACP 映射 `input` | **可用**（有 input 时才出现） |
| `output` | `cell.outputDetail` 或 `codeProgram(cell)`（`:1006-1007`） | ACP 映射 `output` | **可用**（有 output 时才出现） |
| `schema` | `cell.schemaDetail`，由 `attachToolSchema`（`layout.ts:638-647`）从 `callSchemas.get(laid.callId)` 注入 | 需 `callSchemas` | **必现但空**：`RecordSchema`（`TrajectoryTable.tsx` `if (!record.cell.schemaDetail) return <p className={css.noPayload}>{t('record.schemaUnavailable')}</p>`）→ 优雅降级为一行 unavailable 文案 |
| `timing` | `cell.startedAt` / `cell.timeSeconds`；assistant 才走 `assistantMetrics` | ACP 映射 `startedAt` + 时长 | **可用**：`RecordTiming` 非 message-kind 走 `<dl>`，`formatElapsedSeconds(null)` 渲染 `—`，`timing.source` 显示 `timing.notAvailable` → 优雅降级 |
| `raw` / `source` / `rendered` | 仅 markdown 记录（`isMarkdownRecord`，`:991-1000`）与 system 记录 | 不适用 | **不出现**（不进 `detailTabs` 列表，非"空 tab"） |
| `usage` / `options` / `diff` | 仅 `REQUEST_TABS`（`:231-236`）与 `SYSTEM_UPDATE_TABS`（`:227-230`），即 request-header / system 记录 | 不适用 | **不出现** |

补充：`options` tab 还有一层过滤 `:2331` `REQUEST_TABS.filter(tab => tab.id !== 'options' || selectedRequestOptions !== undefined)`；`RecordPayload`（`TrajectoryTable.tsx:1703`）在缺值时返回 `record.noPayload` / `record.noResult` 文案；`RecordTiming`（`RequestTiming` 分支）在 `request.startedAt === undefined` 时另有 `timing.notAvailable` 文案。

**ACP 降级清单（可执行）**：
- ✅ 必须提供：`cell.inputDetail`（raw input）、`cell.outputDetail`（raw output）、`cell.text`/`toolName`（标题）、`cell.timeSeconds`/`startedAt`、`cell.sourceSeq`（= 记录 seq）、`cell.callId`。
- ⚠️ 一定为空但**不崩**：`schemaDetail`（文案降级）、`previewMarkdown`（可选）、`messageSource`/`input.sourceBlocks`（可选）。
- ❌ **不要出现的 tab**：`raw` / `source` / `rendered` / `usage` / `options` / `diff` —— 它们不在工具记录分支中，天然不出现，无需处理。
- ❌ **不可提供的**：`assistantMetrics`（ACP 无 TTFT 语义，见第 7 节）、`promptDetail` / `previousPromptDetail`。

### 5.4 `TrajectoryCellKind` 也是封闭的（7 个）

`trajectory-record.ts:9-16`：`system | user | context | compacted | message | tool | subtool`。ACP 应映射到 `'tool'`（`layout.ts:482` 对 `tool-result` 即用 `kind: 'tool'`）。

---

## 6. Q6 — `request-header` / `RequestView`：ACP 会话在轨迹里显示什么？

### 6.1 关键更正：ACP **确实有** `request/header`

问题前提「ACP 回合没有 `request/header` 事件」**不成立**。`request/header` 由 `packages/core/agent-loop/src/agent.ts` 的 `buildRequest` 写入（`:637-650`，`reason` 取 `'initial' | 'resume' | 'change' | 'series'`），而 ACP 是**经 `ctx.llm.registerAdapter(routes, adapter)` 注册的普通 LLM adapter**（`src/host/apply.ts:225`），`AcpAdapter extends LlmAdapter`（`src/host/service/acp-adapter.ts:244`）。

agent-loop 是适配器无关的：`agent.ts:307` `append('turn/start')`、`:331` `append('step/start')`、`:358` `append('step/end')`、`:387` `append('turn/end')`、`:453` `preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)`、`:468/:538` `append('assistant/message')`、`:682` `append('request/context')`。**ACP 会话与原生会话共享同一套装配，轨迹因此天然获得 turn/step/request-header/assistant 记录。**

同时核对插件内是否越过 agent-loop 自行写事件：`grep -rn "turn/start|step/start|assistant/message|request/header|tool/call|tool/result" src/` → **0 命中**。插件只写 `plugin:acp/*`（`src/shared/records.ts:94-100`），符合 AGENTS.md 约束。

**结论**：不需要插件补 `request-header` contribution。轨迹里的「请求头 / prompt / tools」会显示 **DSH 侧真实请求信封**——即 `canonicalHeader({ config, adapterDefaults, tools })`（`agent.ts:632-636`）。ACP 的 `context: { contextWindow }` 也会经 `preparedCall.context.contextWindow` 进入 `request/context`（`agent.ts:670-682`；ACP 侧提供处 `acp-adapter.ts:588-615`）。

### 6.2 但「看不到 ACP 自己的 system prompt」是真实缺口

轨迹的 `system-prompt` contribution 来自 `system/message` 事件（`trajectory-request-header-definition.ts:32-89`，`match` 在 `:36-39` 只认 `system/message` 与 surface 变更）。ACP 的 system prompt 是**外部 agent 进程内部**的，DSH 不会把它写成 `system/message`。

`src/host/service/transcript.ts`：`systemText`（`records.ts` 引用处附近）用于把 ACP 的 system 段拼进 prompt，但这是**发往 ACP 进程的文本**，不是 DSH 的 surface 事件。

**判定**：轨迹里 `system-prompt` 区域显示的是 DSH 自己的 system prompt（通常很短或为空）。ACP 侧 system prompt 不可见——这是**如实的能力边界**，不应伪造 `system/message`。若产品需要展示，只能由插件新增一条 `plugin:acp/system-prompt` 记录 + 在 chat 侧渲染；**不要**写进轨迹的 `system-prompt` contribution（那会污染 request-header 的 `change` 计算，`trajectory-snapshot-builder.ts:202-203 / 216-250`）。

> rc.2 源码，未在 rc.3 复核。

---

## 7. Q7 — usage pill 与 ContextMeter 的数据来源

### 7.1 `conversation.composer.dock` 的 usage pill

注册：`packages/client/ui-chat/src/client/apply.ts:320-329`（`id: 'usage'`，`order: 1`，`inject: statPillInject` 提供 `hooks: { performanceUsage }`）。
组件：`StatsPills.tsx` 的 `UsagePill`，取数 `const usage = useProjection('tokenUsage')`：

```ts
if (usage === undefined || (billedInputTokens(usage) === 0 && usage.outputTokens === 0)) return null
```

即：**没有 token 活动就不渲染**。`tokenUsage` 投影定义在 `packages/llm/token-meter/src/usage-projection.ts`，schema `round:70-74`：`contextWindow` / `pressureTokens`（可选），核心数据源 `usageOf`（`:82-86`）：

```ts
if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
```

**ACP 满足这条链**：`acp-adapter.ts:1369` `yield { type: 'usage', usage: usageDelta(response.usage, ...) }`；`usageDelta`（`chunk-translator.ts:104-119`）**总是**设置 `inputTokens` / `outputTokens` / `totalTokens`（`cachedReadTokens`/`cachedWriteTokens`/`thoughtTokens` 仅在 >0 时附加）。agent-loop 将其折叠进 `assistant/message`，投影据此产出 `tokenUsage`。

`normalizeUsage` / `turn-usage.ts` 对 `totalTokens` 的要求（`:104-118`）：若 `totalTokens` 缺省，**必须**同时有 `cacheReadTokens` 与 `cacheWriteTokens` 才能推导；否则该 attempt 被丢弃（`return undefined`）。ACP 总是给 `totalTokens`，**故安全**。

**结论：usage pill 在 ACP 会话中应已正确显示，无需新增投影字段。** 唯一注意：`billedInputTokens(usage)` 依赖 `uncachedInputTokens`（`TokenUsageProjection`，`projection.ts:9-19` 四桶互斥），ACP 的 `inputTokens` 是 ACP 协议语义的未缓存输入（`chunk-translator.ts:106` `delta(current.inputTokens, previous?.inputTokens)`），语义对齐。

### 7.2 `ContextMeter`

`packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx`：
- `:62` `const pressure = useProjection('contextPressure')`；`:63` `const breakdown = useProjection('contextBreakdown')`；
- `contextOccupancy(pressure)` 返回 `null` 时**整组件 `return null`**（`:100`）；
- 文件头注释（`:1-5`）明确：*Renders nothing until a provider reports both pressure and a route capacity.*

`ContextPressureProjection`（`packages/llm/token-meter/src/projection.ts:28-48`）：

| 字段 | 生产者 | 是否必需 |
| --- | --- | --- |
| `pressureTokens` | `usageOf` 命中的任何 usage 事件（`usage-projection.ts:192-199`） | **必需**（否则 `projectedTokens` 也不产出，`ContextMeter` 不出） |
| `projectedTokens` | `pressureTokens + surfaceTokens - sampledSurfaceTokens`（`usage-projection.ts:210-215`） | 派生，无需插件供给 |
| `contextWindow` | `request/context` 事件（`usage-projection.ts:181-190`；agent-loop 在 `agent.ts:670-682` 写） | **必需**（"route capacity"） |

**ACP 两者都满足**：
- `pressureTokens` ← `usage` chunk（`acp-adapter.ts:1369`）；
- `contextWindow` ← `acp-adapter.ts:588-615` 的 `context: { contextWindow }`，回退链 `configured → 观察到的 size → inferContextWindow(名称/描述) → profile.contextWindow → DEFAULT_CONTEXT_WINDOW(200_000)`（`src/host/config/constants.ts:3`）。

**结论：ContextMeter 在 ACP 会话中也应正常工作，最小投影字段已真实存在。** 无需要新增字段。唯一风险是 `inferContextWindow` 对某些模型名推断错误 → 百分比失真（属产品问题，非契约缺口）；`acp-adapter.ts:848` `this.contextWindows.set(binding.provider, turn.model, update.size)` 会用实际上报的 size 修正。

> rc.2 源码，未在 rc.3 复核。

---

## 8. 最小贡献映射方案（可执行契约）

### 8.1 方案总述

**不改任何现有 `target: 'chat'` Definition**（保留 chat 卡片），**新增 3 个 `target: 'trajectory'` 的 Definition**，与现有三个一一镜像，共用同一批 `plugin:acp/*` 事件（跨 target 不互斥，见 3.4）。每个新 Definition 的 `buildViewNode` 返回**自建信封**（第 2.4 节，7 个字段，不 import `trajectoryNode`），`data` 为 `{ kind: 'node', node: <ConversationNode> }`。

**必须新建的 Definition 数量：3 个**（tool-call / plan / permission）。
**`target` 值：字符串字面量 `'trajectory'`**（`ConversationNodeDefinition.target?: string`，`conversation.ts:215-216`；无联合约束）。

> 若产品只要求「工具调用」进轨迹，则可缩减为 **1 个**；计划与权限的可见性属产品范围决策。最小技术闭环 = 1，完整对齐 chat = 3。

### 8.2 三条通道的可行性分级

| 记录 | 建议形态 | 轨迹可见性 | 代价 |
| --- | --- | --- | --- |
| `plugin:acp/tool-call` | `{ kind: 'node', node: ToolResultNode-shaped }` | **可见**（`layout.ts:471-504` 认 `tool-result` → `kind: 'tool'` cell） | 需填 `ToolResultNode` 全字段；`args` 需类型逃逸或上游放宽（5.2） |
| `plugin:acp/plan` | `{ kind: 'node', node: UnknownSurfaceNode }` | **不可见**（fold 无分支，静默丢弃，不崩） | 无法进轨迹；只能留在 chat 侧 |
| `plugin:acp/permission` | `{ kind: 'node', node: UnknownSurfaceNode }` | **不可见**（同上） | 同上 |

**这是必须写进实施票的诚实结论**：在 `TrajectoryContribution` 封闭、`ConversationNode` 也可枚举的现实下，**只有 tool-call 能进轨迹**，且是以 `tool-result` 的形状。plan/permission 没有对应材质——除非上游开放新的 contribution kind 或新的 `ConversationNode` 成员。

**替代方案（不推荐但列出）**：把 plan/permission 也塞成 `ToolResultNode`（`name: 'acp-plan'`、`content: [{type:'text', text: 渲染后的计划}]`）。技术上可行、渲染不会崩，但会把「计划」伪装成「工具结果」，与 AGENTS.md「log records must be truthful」精神冲突，且 `toolCallFocus` / `inspectCall` 会把它当成可跳转的工具调用。**建议明确否决，或仅在票面记录为备选。**

### 8.3 tool-call 的具体字段映射

| `ToolResultNode` 字段 | 来源（`AcpToolCallRecord`，`src/shared/records.ts:30-46`） |
| --- | --- |
| `kind` | 常量 `'tool-result'` |
| `seq` | 触发事件的 `event.seq`（**注意**：须用记录事件自身的 seq，与 `anchorSeq` 一致以避免排序抖动，`trajectory-snapshot-builder.ts:295`） |
| `time` | `record.updatedAt` |
| `callId` | `` `${record.runId}:${record.callId}` ``（与现有 chat Definition 的 id 一致，`records.ts:97`） |
| `name` | `record.title`（ACP 无独立工具名词，`title` 是唯一人类可读标识） |
| `args` | `PartialArguments.fromText(record.input ?? '')` 的等价物；**若无法取到该类，则 `as unknown as ToolArgs` 传入，并在票面记录为技术债** |
| `call` | `{ name: record.title, argsRaw: record.input ?? '' }`（或 `null` 当 `input === null`） |
| `callTime` | `record.startedAt` |
| `content` | `record.output` → `[{ type: 'text', text: record.output }]`；`record.content` 中的 `text` 直传，`diff/image/link/terminal` **降级为 text 摘要**（信息不丢失的最保守做法） |
| `isError` | `record.status === 'failed'` |
| `subCalls` | `[]` |
| `error` / `meta` / `parentCallId` | 省略 |

对应 `TrajectoryCellProps`（由 fold 派生，插件不直接写）：
- `inputDetail` ← `call.argsRaw`（`layout.ts:487`）
- `outputDetail` ← `detailResult(node)`（`layout.ts:488`）
- `text` / `toolName` ← `summarizeCall(name, argsRaw)`（`layout.ts:1093-1102`）
- `timeSeconds` / `startedAt` ← `durationSeconds` / `finiteTime(callTime)`（`:493-494`）

### 8.4 新 Definition 骨架（形态示意，非最终代码）

```ts
// kind 必须与 chat 侧不同（definition-registry.ts:49）
export const acpToolCallTrajectoryDefinition: ConversationNodeDefinition<AcpToolCallRecord> = {
  kind: 'acp-tool-call-trajectory',
  target: 'trajectory',
  match: (event) => {
    const type: string = event.type
    if (type !== ACP_TOOL_CALL_EVENT) return null
    const data = event.data as AcpToolCallRecord
    return { id: `${data.runId}:${data.callId}`, role: data.phase }
  },
  start: (_context, match) => match.event.data as AcpToolCallRecord,
  update: (_context, match) => match.event.data as AcpToolCallRecord,
  buildViewNode: (context) => {
    if (context.start === undefined) return null
    return {
      key: context.key,          // 必须 === context.key（assembler.ts:909-911）
      kind: context.kind,
      id: context.id,
      target: 'trajectory',      // 必须 === 'trajectory'（assembler.ts:912-914）
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      data: { kind: 'node', node: toToolResultNode(context.state, context.start.event.seq) },
    }
  },
}
```

要点：
1. **不 import** `trajectoryNode`（不可达，第 2 节）；自行展开信封。
2. **不注册** `target: 'trajectory'` 的 view（上游已注册，重复会抛，`view-registry.ts:12-15`）。
3. `kind` 不与现有 `'acp-tool-call'` / `'acp-plan'` / `'acp-permission'` 冲突。
4. 不返回 `exclusive` —— 让 chat 侧继续同时渲染（3.4）。
5. 全程只读 `plugin:acp/*`，**不写任何 `tool/call` / `tool/result`**。

### 8.5 落地前置检查（实施票应包含）

- [ ] 在 `rc.3` 打包件上复核 `TrajectoryContribution` 仍是 8 成员封闭 union（第 1.1 节）。
- [ ] 在 `rc.3` 上复核 `ui-trajectory` 的 `package.json` `exports` 仍不含 `trajectoryNode`（第 2.2 节）。
- [ ] 确认 `ToolArgs` 逃逸方案可接受，或先向上游提 issue 请求放宽 `ToolResultNode.args` 为可选。
- [ ] 补一条 `kind: 'unknown'`（plan/permission）**不崩**的回归测试——证明"不可见但不崩"是稳定行为，而非偶然。
- [ ] 现有 `tests/client-tool-record.test.tsx` 的 `target: 'chat'` 断言（`:44-45`）不受影响。

---

## 9. 三档汇总（最终）

### 可做（有充分一手证据）
1. 新增 `target: 'trajectory'` 的 Definition，让 **ACP tool-call** 以 `kind: 'node'` + `ToolResultNode` 形状进轨迹（`trajectory-snapshot-builder.ts:233-237`、`layout.ts:471-504`）。
2. 复用上游 `'trajectory'` builder，**无需注册** view target（`view-registry.ts:8-16`）。
3. 与 chat 侧三个 Definition 并存，跨 target 不互斥（`conversation.ts:11-20`、`assembler.ts:519-536`）。
4. usage pill 与 ContextMeter 在 ACP 会话应已正确工作，无需插件补字段（`chunk-translator.ts:104-119`、`acp-adapter.ts:1369 / 588-615`、`usage-projection.ts:82-86`）。
5. 自查信封替代 `trajectoryNode`（10 行赋值，`trajectory-definition-common.ts:19-28` + `assembler.ts:906-915` 两项校验）。

### 不可做（有明确反证）
1. 插件自带新 contribution kind —— `TrajectoryContribution` 封闭、无 merge 扩展（`trajectory-contract.ts:23-58`）。
2. 从外部包导入 `trajectoryNode` —— 非 barrel 导出、`files` 不含 `src`、模块表不可达、本插件未依赖（第 2 节全节）。
3. 一个 Definition 同时服务 `chat` + `trajectory` —— 契约却为 `Sole view target`（`conversation.ts:215`）、`buildNode` 单值比对（`assembler.ts:906`）。
4. plan / permission 进轨迹 —— 无匹配的 contribution kind，`ConversationNode` 也无对应成员（5.3 表格、8.2 表格）。
5. 让轨迹显示 ACP 侧 system prompt —— 需伪造 `system/message`，违反 AGENTS.md 且污染 header change 计算（6.2）。
6. `ConversationViewNodeRegistration` —— **该类型在 harness 中不存在**（全文搜索 0 命中）；真实的 inspect 机制是 `ConversationViewDefinition.toolCallFocus` + `apply.ts:394-401`。

### 需要上游（DSH）
1. **放宽 `ToolResultNode.args`** 为可选，或导出 `PartialArguments` 到 client module table —— 消除 8.3 的类型逃逸。
2. **开放 `TrajectoryContribution` 扩展点**（如 merge-extensible kind map）—— plan/permission 才能真正进轨迹而不伪装。
3. **开放 `DetailTab` 或提供 `callSchemas` 注入点** —— 让 ACP 工具卡能有真实 `schema` tab，而非 `record.schemaUnavailable` 文案。
4. **明确 `inspectCall` 的目标优先级** —— 当前取"第一个可见的 inspection target"（`apply.ts:394-401`），插件无法影响，轨迹与 chat 谁先取决于 view `order`。

---

## 10. 附：本文引用的一手来源索引

**DSH rc.2（`/Users/xulilili/Downloads/闲聊/deepseek-harness`，commit `687f282e`）**

| 主题 | 文件:行 |
| --- | --- |
| contribution 封闭 union | `packages/client/ui-trajectory/src/client/trajectory-contract.ts:23-58` |
| builder 消费 kind | `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts:222-275` |
| 信封构造 | `packages/client/ui-trajectory/src/client/trajectory-definition-common.ts:14-28` |
| 包导出面 | `packages/client/ui-trajectory/src/client/index.ts:31-41`；`package.json:21-25,73-78` |
| view 注册 | `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts:303-320` |
| Definition 契约 | `packages/client/ui-conversation/src/client/contract/conversation.ts:11-20,167-176,213-273,317-333` |
| target/buildViewNode 成对 | `.../conversation/event-registry.ts:111-117` |
| claim 解析 | `.../conversation/assembler.ts:519-536` |
| buildNode 校验 | `.../conversation/assembler.ts:906-915` |
| view registry 去重 | `.../conversation/view-registry.ts:8-16`；`conversation/definition-registry.ts:49` |
| inspectCall | `packages/client/ui-conversation/src/client/apply.ts:394-401` |
| ConversationNode union | `packages/client/ui-conversation/src/client/contract/records.ts:257-268` |
| UnknownSurfaceNode | 同上 `:209-221` |
| ToolResultNode | 同上 `:161-183` |
| TrajectoryCellKind / Props | `packages/client/ui-trajectory/src/client/trajectory-record.ts:9-16,40-105` |
| DetailTab + detailTabs | `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:170-189,231-236,976-1011,2331` |
| fold 分发（无 else） | `packages/client/ui-trajectory/src/client/layout.ts:402-505` |
| schema 注入 | `packages/client/ui-trajectory/src/client/layout.ts:638-647` |
| request/header 写入 | `packages/core/agent-loop/src/agent.ts:632-650,670-682` |
| 通用 turn/step/message | `packages/core/agent-loop/src/agent.ts:307,331,358,387,453,468,538` |
| usage 投影 | `packages/llm/token-meter/src/usage-projection.ts:82-86,181-215` |
| 压力投影契约 | `packages/llm/token-meter/src/projection.ts:9-48` |
| turn-usage totalTokens | `packages/llm/token-meter/src/turn-usage.ts:104-118` |
| usage pill | `packages/client/ui-chat/src/client/apply.ts:320-329`；`chat/StatsPills.tsx` `UsagePill` |
| ContextMeter | `packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx:1-5,62-63,100` |
| 模块表解析 | `packages/client/modules/src/client/system.ts:330-337`；`manifest.ts:218-220` |
| PartialArguments | `packages/util/values/src/partial-json.ts:76-85` |

**dsh-acp-pro（`/Users/xulilili/Downloads/dev/code/dsh-acp-pro`）**

| 主题 | 文件:行 |
| --- | --- |
| 三个 chat Definition | `src/client/conversation/records.ts:90-114,117-141,148-172` |
| 记录名与类型 | `src/shared/records.ts:30-46,94-100` |
| adapter 基类 | `src/host/service/acp-adapter.ts:244` |
| adapter 注册 | `src/host/apply.ts:225` |
| contextWindow 链 | `src/host/service/acp-adapter.ts:588-615,848` |
| usage chunk | `src/host/service/acp-adapter.ts:1369`；`chunk-translator.ts:104-119` |
| 记录写入 | `src/host/service/acp-record-sink.ts:25-29` |
| client 打包/外部依赖 | `tsdown.config.ts:7,37-39` |
| verified 无原生事件 | `grep -rn "turn/start\|tool/call\|..." src/` → 0 命中 |
