# dsh-acp-pro 当前架构审计

审计日期：2026-10-26。范围为当前工作区中的源码、仓库规划和已链接的 DSH 包。本文只记录静态证据；未启动桌面端或真实 ACP agent。本文所有 `docs/roadmap.md` 行号均指审计开始时 `HEAD=36b8231` 的历史稿；该文件之后已由 root 更新，引用行号不代表当前版本。

## 结论

插件当前已经形成清楚的 Host / shared / Client 主链：Host 将 ACP agent 包装为 DSH `LlmAdapter`，将真实 ACP 更新写成 `plugin:acp/*` 会话记录；shared 定义记录契约；Client 按记录定义折叠状态并用 chat slot 渲染卡片。可持续扩展的主方向是保留这个协议边界，同时收拢少数 DSH 私有接缝，并把能力元数据按其真实作用域建模。

思考强度通路并非空白：ACP `thought_level` 被映射为 DSH reasoning 元数据，生成时读取 `GenerateOptions.reasoningEffort` 并调用 ACP `session/set_config_option`。但已找到一个独立于冷启动的模型作用域缺口：`resolveModel()` 读取进程级最近一次 `advertisedEfforts`，而测试 agent 明确让 `mock-smart` 独有 `max`；当前测试只断言 `mock-fast`。这应作为下一阶段首个可回归用例。插件链路可用不等于已确认 DSH 实际界面显示了控件，也不等于确认用户现场故障原因。

## 现有规划、术语和工作区状态

- 长期规划集中在 `docs/roadmap.md:1-14,28-43,65-130`：文档标记 v0.1 已完成，后续列出 v0.2 原生视觉、v0.3 控制面、v0.4 会话生命周期、v0.5 富内容交互、v0.6 子 agent、v0.7 能力与注册表、v0.8 分发及 v1.0 稳定。`docs/architecture.md` 说明记录到卡片的既有设计；`docs/acp-ecosystem-survey.md` 记录 ACP agent、Zed、monoCode 和 acp-components 等参考。
- 在 `README.md`、`docs/` 的检索范围内，未发现 “Multica” 条目；若规划中的目标确为某个名为 Multica 的产品，需要补足准确项目名/链接后再比较。monoCode 已在调研中出现（`docs/roadmap.md:56-62`）。
- 仓库中 “MIT” 的可证含义是许可证/代码来源：`package.json:6` 标明本插件许可证 MIT，`skills/engineering/dsh-plugin/SKILL.md:124` 和 `docs/dsh-plugin-dev/07-safety-compatibility.md:34-41` 说明整合了 `Fleey/deepseek-harness-acp` 的 MIT 代码并要求保留 `LICENSE` / `NOTICE`。这不能单独解释“消除依赖上游修改”；源码中更明确的上游耦合见下节。
- 审计开始时 `HEAD=36b8231`，`main` 比 `origin/main` 超前一个仅含约定、skills 和插件指南的提交；工作区已有未跟踪 `.serena/`，审计未触碰它。`docs/design/` 原本不存在，本报告按任务指定路径新建。

## Host、shared、Client 边界与实际调用链

1. **配置和注册（Host）**：`src/host/apply.ts:104-145` 读取 ACP agent profiles、构造 `AcpAdapter` 并接入 DSH agent/approval/attachment/session 服务；`src/host/apply.ts:158-206` 注册模型发现、provider 路由、可配置 provider 与配置更新协调。`src/host/config/schema.ts:35` 将 `discoverModels` 默认设为 `true`。
2. **模型与生成（Host → ACP）**：`AcpAdapter.resolveModel()` 探测 agent、整理模型元数据和 reasoning（`src/host/service/acp-adapter.ts:232-259`）。普通生成从 DSH `GenerateOptions` 读取 provider/model/session，按 route + DSH session id 复用 ACP session；cwd、模型或 agent generation 改变时新建 session，选模型和 effort 后发送 prompt（`src/host/service/acp-adapter.ts:366-415`）。ACP stdio/JSON-RPC 生命周期与 config option 适配集中在 `src/host/service/acp-agent.ts:146-225,228-285,318-348`。
3. **记录（Host → shared）**：`ChunkTranslator` 将 ACP 文本、thought、tool、plan 更新转换成 DSH stream chunks（`src/host/service/chunk-translator.ts:20-98`）；`acp-record-sink.ts` 将真实 tool/plan/permission 状态写为 `plugin:acp/*` 快照，调用 `appendPluginRecord`（`src/host/service/acp-record-sink.ts:1-29`）。记录名和 payload 位于 `src/shared/records.ts`；不伪造 DSH 原生 tool call，符合 `docs/dsh-plugin-dev/07-safety-compatibility.md:3-22`。
4. **呈现（Client）**：`src/client/index.ts:11-31` 注入 slots、locale、remote 和 configForms，注册三个 conversation definitions，并在 `conversation.chat.node` 注册 ACP 工具、计划和权限渲染器；`src/client/conversation/records.ts` 定义折叠，`src/client/components/record-nodes.tsx` 呈现。ACP agent 管理页用 `settings.section` 和 DSH config form（`src/client/register/agents-section.ts:19-40`）。当前权限卡只展示，答复仍走 DSH 原生 approval（`src/host/apply.ts:121-123`）。

**认证已有基础能力**：profile 含 `authMethod`（`src/shared/types.ts:20-32`），设置表单让用户填写 ACP method id；配置后 Host 在 initialize 后发 `authenticate({ methodId })`，若不配置则跳过（`src/host/service/acp-agent.ts:440-452`）。`session/new` 遇到 auth-required 会映射为 `MISSING_CREDENTIAL` 并列出 agent 广告的方法（`acp-agent.ts:210-218`）。这不是通用 credential/token 收集界面：凭据留给 agent 自己的 CLI、环境或其认证实现。现有 adapter 用例覆盖认证成功、错误 method id 和缺凭据提示（`tests/adapter.test.ts:223-237`）。

## 思考强度：代码已通，模型级能力元数据不完整

- `acp-agent.ts:84-108` 从 `session/new.configOptions` / 更新中提取 `category: 'thought_level'`；`discoverModels()` 会建 ACP session 以取得模型目录与配置选项（`acp-agent.ts:324-340`）。默认配置下，`resolveModel()` 在读取 effort 前会探测模型目录（`acp-adapter.ts:232-252`），所以不能仅凭 `learnCapabilities()` 只做 initialize 就断言首次请求前没有 effort 信息。
- DSH `dsh-llm@0.2.1-rc.2` 当前类型契约包含 `LlmResolvedModelInfo.reasoning` 与 `GenerateOptions.reasoningEffort`（本地链接包 `node_modules/@deepseek-ai/dsh-llm/lib/typert.host.js:360,452` 的类型声明）。插件把 `thought_level` 列表返回到模型元数据（`acp-adapter.ts:251-287`），生成时读取 `options.reasoningEffort`，未提供时取 ACP session 初始 effort，然后经 `selectEffort()` 发 `session/set_config_option`（`acp-adapter.ts:386-404`、`acp-agent.ts:264-285`）。
- **已定位的作用域缺口**：`advertisedEfforts` 存在 `AcpAgentProcess` 实例上，注释语义是“最近一次 session”的 effort（`acp-agent.ts:153-188`）；但 `resolveModel(provider, model)` 对任一 model 都读这份进程级缓存（`acp-adapter.ts:240-258`）。测试 fixture 的 `mock-agent.mjs:23-31` 明确 `mock-smart` 才提供 `max`，且 `session/new` 默认 `mock-fast`、`medium`（`mock-agent.mjs:103-116`）；切换模型后 `selectModel()` 刷新的是该 ACP session 自身的 `configOptions`（`acp-agent.ts:228-241`），并不更新 `process.advertisedEfforts`。因此模型解析可能把 `mock-fast` 的 levels 返回给 `mock-smart`，遗漏 `max`。
- 当前用例 `tests/adapter.test.ts:251-263` 名为 `exposes the agent thought levels and image input as model metadata`，只断言 `mock-fast` 的 levels；`tests/adapter.test.ts:265-275` 的 `applies the selected reasoning effort and restores the agent default` 验证 effort 的请求应用/恢复，但也固定在 `mock-fast`。没有对模型专属 `max` 的解析断言。建议将“解析 `mock-smart` 时暴露 `max`，切换模型后 effort 候选与当前 session 一致”列为首个回归验收；本审计未新增针对该缺口的新回归用例，现有测试基线已运行并通过。
- 当前链接 checkout 的 `dsh-client-ui-chat`、`dsh-client-ui-session`、`dsh-client-store` 中，静态搜索 `reasoningEffort`、reasoning levels 和 `resolveModel` 未找到 selector 调用；这些包不一定包含桌面应用的选择器。只能确认 DSH SDK 契约与插件侧适配通路存在，无法确认用户看到的原生控件、实际调用顺序或 `GenerateOptions.reasoningEffort` 的值。应在下一阶段用具体 profile + agent + model 复现并观察 UI 元数据与请求参数；本轮未启动 app/agent。

## DSH 上游耦合和可用扩展面

| 边界 | 当前证据 | 对长期架构的含义 |
|---|---|---|
| DSH 包版本 | `package.json:64-72` 的 DSH peer dependencies 使用 `*`；本机 `node_modules/@deepseek-ai/*` 是指向 `deepseek-harness` checkout 的 symlink，检查到的 `dsh-llm`、`dsh-session`、Client UI 包版本均为 `0.2.1-rc.2`。 | 构建依据是可变本地 checkout，manifest 没有锁住 DSH 兼容范围。当前包导出根路径或 `/client` 子路径不等同于正式稳定性承诺。指南只明确指出 plugin-record API 属 experimental、无稳定承诺（`07-safety-compatibility.md:39-49`）；其它 API 的公开稳定级别需由上游文档/正式版本确认。 |
| Host 服务和事件 | `src/host/apply.ts:27-60,82-87,118-156,205-206` 自定义结构类型并动态 `ctx.get('agents'/'sessions'/'approval'/'attachments'/'loader')`；访问 `ctx.fiber.entry.options.id`，监听 `internal/plugin`、`loader/volatile-update`。`mcp-servers.ts` 遍历 Loader entry tree。 | 这些具体 service id、事件名、fiber/loader 结构是显著上游耦合点；应隔离在窄适配层并做版本契约探测。不要把 `ctx.llm` 已有 provider 注册 API 与这些私有接缝混为一类。 |
| 会话记录 API | `appendPluginRecord` 从 `@deepseek-ai/dsh-session` 根导出调用，但 DSH 指南明确其来自 experimental 区且没有官方稳定承诺（`07-safety-compatibility.md:39-49`）。 | 这是最直接的 API 升级风险。保留 truthful `plugin:*` 语义；跟踪上游正式扩展面/兼容矩阵，失败降级规则已有 roadmap 讨论（`roadmap.md:148-156`）。 |
| Client 扩展 | Conversation Definition、`conversation.chat.node` slot、settings section 在当前代码中已实际注册；`@deepseek-ai/dsh-client-ui-chat/client`、`ui-conversation/client` 为包导出子路径。 | 当前卡片/设置可走 DSH slot。Roadmap 的 `conversation.input.dock` composer chips 和 host RPC 是目标，不是当前已接入能力（`roadmap.md:126-130`）；仓库无插件 RPC 注册/调用实现。 |
| 模型页 DOM | `src/client/register/models-hint.ts:7-20` 用 MutationObserver 改写官方 Models 页面提示，代码注释说明该编辑器无 slot。 | 这是确实依赖上游 DOM 文案/结构的补丁，容易随 UI 改版失效；`cordis.patch.yml:1-3` 本身则是声明 bundle 注入的插件机制，不是修改 DSH 上游源码。 |

公开扩展面已用于 provider / configurable provider / model discovery、settings section、conversation definitions 与 slots；MCP 转发也已实现。插件没有自有 host RPC；permission 按钮仍是 roadmap 工作项。ACP 支持的是 stdio `initialize`、`session/new`、`session/prompt`、取消及条件式 `session/close`；当前 DSH ↔ ACP 绑定保存在 `AcpAdapter` 内存 Map，匹配 route/session/cwd/model/generation 并用 consumed ids 增量发送。未发现 `session/list`、resume/load/delete/fork 或持久化 ACP session id 的现有路径；跨桌面进程恢复属于 `roadmap.md:82-85,121` 的后续工作。

**持久化并非全无**：用户 agent profile 由 DSH config forms/host settings 管理；插件另把 initialize prompt capabilities 和 context window 写入 `$DSH_HOME/cache/dsh-acp-pro/`（`src/host/apply.ts:53-60,131-145`）。`PromptCapabilitiesCache` 用 route + `spawnFacts` 指纹；指纹包含 command、args、env、cwd、authMethod（`acp-adapter.ts:51-52,308-315,538-560`）。`ContextWindows` 则只按 route + model 缓存（`context-windows.ts:18-27,50-58`）；`AcpAdapter.sync()` 在 spawn facts 改变时重启 agent/丢 binding（`acp-adapter.ts:155-164`），没有清除该窗口缓存。规划中的 `agentInfo.version` 缓存（`roadmap.md:117-124`）不能直接替代 session-scoped config options：fixture 已证明 effort 可按 model 变化；若缓存 capabilities，需明确 initialize 能力、model configOptions、cwd/auth 的作用域与失效规则。

## 规划与实现的偏差、用量语义

- `roadmap.md:34,49,77,161` 将 `session/set_config_option` / `set_model` 迁移描述为未完成或待迁移；当前 `acp-agent.ts:228-244` 已优先调用标准 ACP `session/set_config_option` 并应用返回的 `configOptions`，只有 legacy model list 才走非标准 `session/set_model`。后续规划应更新状态，不要重复实现这项迁移。
- `roadmap.md:34` 称 config_option_update “仅记录”也需与当前代码复核：`applyConfigOptions()` 的实现和注释已覆盖 set-config 响应与 `config_option_update`（`acp-agent.ts:99-108`）；需要区分 session 内状态更新与用户可见 composer 控件，避免以 UI 缺口推断协议处理缺失。
- ACP `usage_update` 提供的是 session 级累计量而非稳定 turn-level 用量（`roadmap.md:45-53`）。当前 `usageDelta()` 对连续快照逐字段做 `max(0,current-previous)`，Adapter 用 binding 保存前次快照（`chunk-translator.ts:100-119`、`acp-adapter.ts:507-508`）。这表示“相邻已观测快照增量”，不是 ACP 明确给出的精确每回合计量；缺失/跨回合更新、重置等会破坏严格归属。规划 UI 应标注来源/精度，并等待 ACP turn-level usage 契约再承诺成本账单。
- 生态计划中已有 ACP、monoCode、Zed 与 acp-components 的行/计划/子 agent 参考；Multica 尚未进入当前文档。把这些产品行为转成 ACP 协议能力映射，优先避免 agent 名称硬编码，与 `roadmap.md:9,140-146` 的既有约束一致。

## 构建、验证及审计限制

仓库指南要求直接运行 `node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vitest/vitest.mjs run`，构建命令是 `node node_modules/tsdown/dist/run.mjs`（`AGENTS.md`、`docs/dsh-plugin-dev/05-build-test.md:5-23`）。审计文档完成后按集成要求执行了前两项：TypeScript 检查退出码 0；Vitest 退出码 0，12 个测试文件、93 个测试通过。未运行 tsdown 构建（本次只改文档），未启动桌面端或真实 ACP agent，也未做现场 UI trace；静态审计不能证明 DSH 当前界面显示思考强度控件或确认用户现场根因。
