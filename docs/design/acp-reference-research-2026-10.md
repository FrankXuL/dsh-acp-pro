# ACP 架构参考调研（2026-10）

**检索日期：2026-10-26。** 本文以 ACP 官方协议/SDK/registry 和 Multica、MonoCode 的固定源码版本为证据。协议页面会继续演进；下文涉及协议字段时优先链接固定 schema 或 commit。实现观察只描述被检出的代码，不代表 ACP 对所有 agent 的要求。

## 结论摘要

1. 主实现宜以 **稳定 ACP v1** 为协议核心，围绕 `initialize`、`session/new`、prompt/update、取消和请求响应构建；根据已协商的能力和真正实现的协议方法，按功能开放可选特性。
2. **ACP v2 应独立评估/适配。** 截至检索日，官方将 v2 标为 draft，schema 是 `2.0.0-alpha.9`；v2 改动包括会话恢复/回放、配置、权限、MCP、terminal/fs 与 prompt 生命周期等，不能仅把 SDK 主版本号当作协议协商结果。
3. 模型、模式和推理强度的通用稳定配置入口是 v1 `configOptions` / `session/set_config_option`。`session/set_model` 曾是官方 TS SDK 的 unstable 接口，但不在本次固定的 v1 基线或 v2 草案基线 schema；应作为需显式版本/agent 检测的兼容路径。
4. 宣告某个配置项不证明 agent 真正应用它。DSH 应根据 agent 返回的完整配置快照显示当前值，并将“协议提供选项”与“该 agent/模型经验证能改变行为”分开。
5. ACP session 与 DSH thread/workspace/job 的生命周期边界需要明确；ACP 工具事件是真实外部执行流，DSH 插件记录应保留来源，不伪造原生 `tool/call` 或 `tool/result`。

## 协议成熟度与版本

ACP 官方文档截至检索日把 v1 标作 latest，把 v2 标作 draft。固定的协议仓库提交 `e2d83349bc9e28a4059ea3acefa1c91c966f74e2` 包含 v1 schema `1.26.0` 与 v2 schema `2.0.0-alpha.9`。协议的 `protocolVersion`、schema 版本、SDK npm 版本是不同概念。

官方 TypeScript SDK `2.0.2` 仍默认使用稳定 v1；v2 入口标为 experimental，unstable v1 API 也有独立入口。因此“升级 SDK 到 2.x”不等于“ACP wire protocol 是 v2”。这里的基线 schema 指 `schema.json`，区别于 `schema.unstable.json`；v2 协议整体仍是 draft。[官方协议版本说明](https://agentclientprotocol.com/protocol/v1/initialization#protocol-version) · [固定 v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/e2d83349bc9e28a4059ea3acefa1c91c966f74e2/schema/v1/schema.json) · [固定 v2 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/e2d83349bc9e28a4059ea3acefa1c91c966f74e2/schema/v2/schema.json) · [官方 TS SDK changelog](https://github.com/agentclientprotocol/typescript-sdk/blob/main/CHANGELOG.md)

官方 SDK changelog 在 `0.4.5` 记录了 unstable initial model selection 支持。这证明 `session/set_model` 曾是官方 SDK 的实验接口，并非某个 Claude agent 私有发明；但该方法不在上述固定版本的稳定 schema。固定 v1/v2 schema 中检索到 0 处 `session/set_model`，而 `session/set_config_option` 出现 5 处。不要把 SDK 中存在过的 unstable 方法描述成稳定 ACP 保证。SDK 后续 `/unstable` 入口里的当前状态未由这份固定 schema 判断，记为未知。

### Registry 的能力探测矩阵

截至检索日，**公开矩阵属于 `agentclientprotocol/registry` 仓库**，路径为 `.protocol-matrix/latest.md`，并非 `agent-client-protocol` 仓库。固定到 registry HEAD `3f088356e372cd6f4f8eb2115b09d8e73a4c53d0` 时，文件标注 2026-10-25、汇总 37 个被探测 agent 的 `initialize` 能力及若干方法探测结果（包含 `session/set_model` 等）。这使旧 survey 中“没有公开能力矩阵”的说法过时。

此矩阵是生态诊断数据：它不验证具体 model/config option 在运行时是否生效，也不应替代连接时的 `initialize` 协商或 agent 版本检查。[固定矩阵页面](https://github.com/agentclientprotocol/registry/blob/3f088356e372cd6f4f8eb2115b09d8e73a4c53d0/.protocol-matrix/latest.md) · [固定 raw 文件](https://raw.githubusercontent.com/agentclientprotocol/registry/3f088356e372cd6f4f8eb2115b09d8e73a4c53d0/.protocol-matrix/latest.md)

## 配置、模型与推理选项

v1 `session/new` 的响应提供 `configOptions`。每项有 agent 定义的 `id`、`name`、`options`，可有 `category`、`description`、`currentValue`；option 可提供 label/description。category 的标准语义包括 `mode`、`model`、`model_config`、`thought_level`。`id` 才是选择时用的标识；不能靠 UI 标签或假设固定 ID 来调用。

`category` 是分类提示，不是配置项存在性的开关。无 category 或不认识的 category 时仍可呈现和设置配置；未知类别可以按一般选项显示。agent 必须提供可用默认值，但 DSH 不能仅因“默认”就宣称它是当前运行值；只有 ACP 返回的 `currentValue` 或更新后的完整状态能证实当前值。布尔选项依赖 Client 在 `initialize.clientCapabilities.session.configOptions.boolean` 声明支持。[v1 配置文档](https://agentclientprotocol.com/protocol/session-setup#session-configuration) · [固定 v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/e2d83349bc9e28a4059ea3acefa1c91c966f74e2/schema/v1/schema.json)

设置选项时，Client 发 `session/set_config_option`，传 `configId` 与 `value`。成功响应带回完整 `configOptions` 状态；`config_option_update` 通知也提供完整配置列表。将两者视为新的完整快照替换旧状态，而非只局部改一项；会话恢复后也以 agent 返回的状态为准。协议不保证 DSH 跨 ACP session 持久保存 agent 私有配置，也不保证不同 agent 对同名选项有相同行为。

v1 模型/模式的选择可使用标准 config category；没有可选项时不应凭空展示通用 selector。`session/set_mode` 是 v1 模式接口；v2 对模式和配置的表达有调整。`session/set_model` 不属于当前稳定 wire contract。对旧 agent 若不得不调用，应限定在明确适配的 agent/版本并处理不支持/错误，优先采用标准 config option。

`thought_level` 只是通用选项类别，协议不能证明“reasoning 已生效”。例如 Multica 在固定实现中对支持范围作了 provider-specific 白名单和注释：`reasonix`、`dim`，以及 Hermes 家族中特定的 JCode ACP；它明确区分 Hermes Agent 与 JCode。该代码还记录了 Kimi `<=0.28.1` 报告接受 `max`、但实际上未应用的情况。此证据说明必须维护实测支持信息，不能把配置 schema 的出现当作效果保证。[Multica 固定实现：推理选项验证](https://github.com/multica-ai/multica/blob/9543a0c65aad9b2783dfcde174458786050174db/server/pkg/agent/thinking.go#L1003-L1053)

## 会话生命周期与运行时协议面

### 稳定 v1 主路径

- 启动时 `initialize` 协商协议版本和 Client/Agent 能力；如 agent 要求认证，按其 `authMethods` 执行认证。仅声明 DSH 实际实现的 Client 能力。
- `session/new` 建立 ACP session；`cwd`、MCP server 配置等属于本次 session 初始化输入。运行中消费 `session/update`，将文本、tool call/status、权限请求及其他 update 映射为 DSH 的插件 UI/记录。
- `session/cancel` 是通知。取消 prompt 后按 ACP 语义停止运行，并处理取消和正常完成之间的竞态；不能把本地按钮点击直接当作 Agent 已确认取消。
- 权限流程中 Agent 发起 `session/request_permission`，Client 按选项 ID 回答用户作出的选择；保留原始请求/decision 的含义和来源。
- v1 会话方法的能力字段各自不同：`session/load` 由 `agentCapabilities.loadSession` 表示；`session/list`、`session/delete`、`session/resume`、`session/close` 分别使用 `sessionCapabilities` 下对应字段。按实际字段逐项决定是否暴露历史/恢复操作；不能把所有方法都归为同一个 session 能力，也不能将恢复失败静默解释为新会话。

### 可选功能要逐项协商

- **文件系统与 terminal：** v1 仍定义 Agent 请求 Client 读/写文件，以及 Client 创建/控制 terminal 的方法。只有 Client 真正提供对应方法并声明能力时才暴露。v2 删除这些 v1 surface，不能据此反向判定 v1 agent 的实现无效。
- **MCP：** v1 `session/new` 传 MCP server 信息；按 agent 的 `mcpCapabilities` 过滤 remote HTTP/SSE 等传输类型，不能把“DSH 可连接”误当成“Agent 支持”。Multica 实际集成包含这一能力过滤。
- **slash commands：** v1 可通过 session update 更新可用命令；v2 在 new/resume 时提供命令列表并按新语义更新。列表由 Agent 返回，客户端不应硬编码通用命令。
- **多模态与资源：** v1 内容可含 text、image、audio、resource、resource_link 等；实际收发受能力和内容类型约束。若 DSH UI 不支持某一内容，保留可诊断的真实类型信息，不要伪装成普通文本。
- **用量：** 标准 `usage_update` 描述 session context/cost，字段为 `used`、`size`（必需）及 `cost`（可选）。协议没有要求 DSH 推算每次回答 token 消耗；只显示 Agent 实际报告的数据，并标明时间/作用域。

### v1/v2 会话差异

v1 有 `session/load`；v2 移除此方法并以 `session/resume` 和 `replayFrom` 支持恢复与事件回放。v1 的 list/resume/close 等能力有对应可选能力标志；v2 的 session 能力模型不同，且 `session/delete` 仍是可选功能。不要把 v2 的默认能力规则套到 v1。

`session/fork` 在当前稳定 v1/v2 schema 之外，属于 unstable/RFD 路线。Registry 的方法探测显示生态中有 agent 暴露该方法，但“被探测到”不等于稳定协议支持。对 DSH 需要的分支/恢复语义，应先决定产品数据模型，不依赖这个 unstable 方法。

## Multica 与 MonoCode 实现观察

以下代码引用固定在具体 commit，方便复查。它们是产品集成样本，不是协议规范。

### Multica (`multica-ai/multica`)

- ACP adapter 用 task/workspace 环境创建、恢复 Agent session，将 `cwd` 和经过能力过滤的 MCP 配置传入 session。Agent 的 `sessionId` 是运行上下文的一部分，Multica task/workspace 仍是产品级执行主体。[初始化与能力协商](https://github.com/multica-ai/multica/blob/9543a0c65aad9b2783dfcde174458786050174db/server/pkg/agent/hermes.go#L3407-L3448) · [session resume/new 与 cwd/MCP](https://github.com/multica-ai/multica/blob/9543a0c65aad9b2783dfcde174458786050174db/server/pkg/agent/hermes.go#L3459-L3556)
- 其旧模型切换与配置选项并存，体现兼容路径与稳定配置的边界；该 provider-specific 实现不构成通用 API 建议。[模型与 effort 配置](https://github.com/multica-ai/multica/blob/9543a0c65aad9b2783dfcde174458786050174db/server/pkg/agent/hermes.go#L3625-L3755)
- 可借鉴：按协商能力过滤输入、明确 workspace/cwd、对推理能力保留 agent-specific 验证。不要照搬：单一 provider 的白名单或旧 `set_model` 作为所有 Agent 的通用逻辑。

### MonoCode (`hardbeat920/monocode`)

- ACP provider 以 v1 初始化；它从 harness 输入读取 `cwd` 和可选既有 ACP session ID，用 `session/load` 恢复，未恢复时以 cwd 调用 `session/new`，并把返回的 ACP session ID 放入运行时状态。这是 ACP session 与宿主提供的工作目录分开的实际样本。[初始化与 load/new](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src/integrations/harness/providers/hermes/hermes.ts#L263-L319)
- 该 provider 调用 `session/set_model` 和 `session/set_mode`，两者稳定性不同：前者属于历史 unstable/兼容路径，后者仍是 v1 模式接口，存在 configOptions 时优先使用配置接口。不能把该 provider 的模型切换路径当作所有 Agent 的稳定保证。[model/mode 调用](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src/integrations/harness/providers/hermes/hermes.ts#L345-L368) · [ACP v1 modes](https://agentclientprotocol.com/protocol/v1/session-modes)
- 它将 `session/request_permission` 请求路由到 permission handler，并通过 `session/cancel` 通知取消；transcript 层会将 thinking/tool/approval 活动及 subagent 区块分组。[权限请求路由](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src/integrations/harness/providers/hermes/hermes.ts#L552-L553) · [取消通知](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src/integrations/harness/providers/hermes/hermes.ts#L147) · [activity 类型与分组](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src/features/sessions/model/transcriptActivity.ts#L138-L173) · [subagent 分组](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src/features/sessions/model/transcriptActivity.ts#L513-L526)
- 可借鉴：由宿主提供工作目录和恢复所需 ACP session ID，再由 provider 建立运行会话；将 ACP permission/activity 接入产品 UI。不要照搬：MonoCode 特定目录/线程模型、产品事件结构或 legacy 模型 API。

## 对 DSH 插件的边界建议

1. **把 ACP session 当运行时对话边界，把 DSH thread/job/workspace 当产品边界。** 保存显式映射（至少 ACP session ID、工作目录、Agent/provider 标识和恢复所需的上下文）；新建/恢复的选择由 DSH thread 生命周期决定。
2. **建立稳定 v1 核心路径，再按能力增量开放功能。** 每个功能都以 initialize 协商、请求响应和真实 adapter 实现为前提；未知能力不能因为 UI 需求而假定存在。以 v2 单独做兼容性设计和迁移评估。
3. **配置 UI 以 Agent 快照为唯一当前状态来源。** 保留原始 config ID/value，按 option 类型渲染；category 缺失/未知不隐藏配置；完整响应或更新替换整份快照。展示 agent default 时清楚表示它是可选默认值，只有 `currentValue` 才作为已报告的当前值。
4. **把“可配置”与“已验证生效”分离。** 协议配置项可用于 UI 和传值；可信推理/模型能力需按 agent + 版本 + 选项验证。`session/set_model` 仅在显式兼容 adapter 中使用，记录来源和不支持结果。
5. **保持事件来源真实。** 将 ACP `tool_call`、permission、status 等事件保存为插件来源记录并渲染对应卡片；不要伪造 DSH 原生工具事件。permission 的允许/拒绝和 Agent 返回状态要基于实际响应。
6. **不要通过能力声明承诺未实现的面。** v1 filesystem、terminal、MCP、audio/image、auth、slash commands 都可选；按实现逐个声明。保留 ACP usage 原始作用域，避免推算每轮指标。

## 许可与复用边界

ACP 协议仓库标注 Apache-2.0。MonoCode 固定版本的 `LICENSE` 标注 MIT；仓库另有 NOTICE，README 对 provider 名称/标识有商标说明。Multica 固定版本的 `LICENSE` 标题为 “Multica License”，包含 Part I 特别条款及 Part II 的 Apache License 2.0 文本，不应按纯 Apache-2.0 处理。这里仅记录工程复用线索，不作法律意见；复制代码、名称、图标或 NOTICE 前由项目确认对应授权和归属要求。[ACP LICENSE](https://github.com/agentclientprotocol/agent-client-protocol/blob/e2d83349bc9e28a4059ea3acefa1c91c966f74e2/LICENSE) · [MonoCode LICENSE](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/LICENSE) · [Multica LICENSE](https://github.com/multica-ai/multica/blob/9543a0c65aad9b2783dfcde174458786050174db/LICENSE)

## 主要一手来源

- [ACP 官方协议文档](https://agentclientprotocol.com/protocol/v1/overview)、[v1 session setup/configuration](https://agentclientprotocol.com/protocol/v1/session-setup)、[v2 migration guide](https://agentclientprotocol.com/protocol/v2/migration)
- [ACP 协议仓库固定提交](https://github.com/agentclientprotocol/agent-client-protocol/tree/e2d83349bc9e28a4059ea3acefa1c91c966f74e2)、[TS SDK changelog](https://github.com/agentclientprotocol/typescript-sdk/blob/main/CHANGELOG.md)
- [ACP registry 固定能力矩阵](https://github.com/agentclientprotocol/registry/blob/3f088356e372cd6f4f8eb2115b09d8e73a4c53d0/.protocol-matrix/latest.md)
- [Multica 固定提交](https://github.com/multica-ai/multica/tree/9543a0c65aad9b2783dfcde174458786050174db)、[MonoCode 固定提交](https://github.com/hardbeat920/monocode/tree/26465c620977f3951d0a532a0f7db32c3c179007)
