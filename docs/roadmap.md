# dsh-acp-pro 长期路线图

> 调研基线：2026-10-25。ACP 侧读的是 `agentclientprotocol/agent-client-protocol` `main`（v1 schema `1.26.0` / v2 `2.0.0-alpha.9`）、`@agentclientprotocol/sdk@1.4.0` 与 `agentclientprotocol/registry`；DSH 侧是 `/Applications/DeepSeek Harness.app` 里的 `deepseek-harness` 源码；生态见 [acp-ecosystem-survey.md](acp-ecosystem-survey.md)。

## 1. 定位

**让任意 ACP agent 在 DSH 里成为一等公民**，而不是"另一个聊天窗口"：

1. 协议优先：UI 由 `initialize` 能力 + 首次 `session/new` 的 `availableCommands` / `configOptions` 驱动，**绝不维护硬编码的 agent 特性表**（ACP registry 48 个 agent 只发布分发信息，没有能力矩阵）。
2. 视觉原生：工具行、计划、diff、审批都对齐 DSH 自己的 `ToolRow` 解剖（icon 14px → 标题 → 目标 → 状态 → 展开），不照搬任何第三方皮肤。
3. 不撒谎：只写 `plugin:acp/*` 插件记录，不伪造 `tool/call` / `tool/result`；会话日志、导出、`session-query`、`repair` 里的事实必须和真实执行一致。
4. 优雅降级：agent 少什么能力，UI 就少一块，而不是报错或空白。

## 2. 现状（v0.1 已完成）

| 能力 | 状态 |
|---|---|
| ACP 进程管理、模型/effort 路由、增量 prompt、取消 | ✅ |
| `tool_call` / `tool_call_update` → `plugin:acp/tool-call` 记录 + 卡片 | ✅（卡片待重做） |
| `plan` → `plugin:acp/plan` 记录 + 卡片 | ✅（待并入计划行） |
| `session/request_permission` → `plugin:acp/permission` 记录 + 只读卡 | ✅（按钮未接线） |
| `usage` → DSH token usage | ✅ |
| MCP servers 透传（stdio/http，`forwardMcp`） | ✅ |
| claude-code 模型目录清洗（`INVALID_CATALOG`） | ✅ |
| `mcp_result` 的终止/取消/空响应处理 | ✅ |
| 设置页 6 个 agent 配置、bundle 安装、i18n、93 条测试 | ✅ |

**关键缺口**（按协议面归类）：

| ACP 面 | 现状 | 目标 |
|---|---|---|
| `available_commands_update` | 忽略 | 映射为 DSH `/命令` |
| `current_mode_update` / `session/set_mode` | 忽略 | composer 模式 chip |
| `config_option_update` / `session/set_config_option` | 仅记录 | 模型/effort/reasoning 选择器（**注意：ACP 没有 `session/set_model`，当前适配器调用的是非标准扩展**） |
| `session/list` / `resume` / `load` / `close` / `delete` / `fork` | 只用 `close` | 重启后恢复 ACP 会话 |
| `usage_update.cost`、`session_info_update`、`notice` | 忽略 | 回合成本徽标、标题同步、系统提示 |
| `compaction_update` / `compaction_summary_chunk` | 忽略 | 压缩事件行 |
| 图片/音频 content chunk | 部分 | 附件行渲染 |
| 子 agent（ACP RFD / v2 child session / v1 `subagent_update`） | 无 | 嵌套卡片（永不并入折叠组） |
| `elicitation/create` | 无 | 表单/URL 弹层（ACP 要求模态） |
| 认证 `authenticate` / `authMethods` | 无 | 登录流程（terminal/API key/env） |
| registry 一键安装 | 无 | 从 48 个 agent 里装 |
| ACP v2（draft） | 无 | 版本协商 + 双形状兼容层 |

## 3. 协议事实（决定架构的硬约束）

- **版本**：`protocolVersion` 是整数主版本；v1 稳定，v2 明确 draft（`schema-v2.0.0-alpha.9`，2026-10-16）。v2 用 `session/resume` + `replayFrom` 取代 `load`，移除 `session/set_mode` 和整个 `fs/*` / `terminal/*`，新增 `state_update`、`plan_update(planId)`、`elicitation`。**现在只实现 v1，v2 留协商开关。**
- **能力协商**：客户端声明 `fs{readTextFile,writeTextFile}`、`terminal`、`auth.terminal`、`session{compaction,configOptions,notices}`、`elicitation{form,url}`；agent 声明 `loadSession`、`promptCapabilities{image,audio,embeddedContext}`、`mcpCapabilities{http,sse}`、`sessionCapabilities{list,delete,additionalDirectories,resume,close}`、`authMethods`。省略即不支持。
- **模型选择**：`session/set_config_option {configId, value}`，`category ∈ mode|model|model_config|thought_level|other`；`set_mode` 是旧路径。我们当前调用的 `session/set_model` 不在 schema 里（claude-code-acp 的私有扩展），必须改成"优先 config option，探测到扩展才回退"。
- **工具内容**：`content[]` 整组替换（v2 才有 append chunk）；`rawInput/rawOutput` 是 `unknown` 且带 `x-deserialize-default-on-error`，可能静默丢 payload（issue #1979 就是权限框因此丢上下文）。
- **turn 级 token 用量不在 v1 稳定面**：`PromptResponse` 只有 `stopReason`；`usage_update` 是会话级上下文规模 + 累计成本；按回合计费只能自己差分（Roadmap v0.3 做）。
- **计划**：v1 `plan.entries[]` 无 planId；v2 才有 `plan_update`。折叠/展开必须按"当前计划"单实例处理。
- **注册表**：`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`，48 条，CI 只验证 `authMethods`；`distribution` 支持 `npx`/`uvx`/`binary`（含 sha256）。**没有能力矩阵**，所以必须运行时探测。
- **DSH 自身先例**：`packages/acp/acp` 是 DSH 的 ACP server，已实现 `session/list|resume|close`、`set_config_option(model, reasoning_effort)`、图片 prompt、stdio/HTTP MCP、权限；明确不做 modes/commands/plans/terminals/fs/elicitation。设计记录 `.agents/notes/implemented/simplification/2026-07-23-acp-automation-only-protocol.md` 说明 ACP 在 DSH 里定位"自动化协议"，交互式 UI 是我们的增量，不是上游默认目标。

## 4. 竞品与可抄的细节

- **Zed**（ACP v2 客户端，Rust）：`crates/agent_ui/src/conversation_view/thread_view.rs`（15k 行）——7 态工具（pending/in_progress/waiting_confirmation/completed/failed/rejected/canceled）、`render_edits_summary` 回合 diff 汇总、`subagent_card.rs`、token/cost 徽标、`activity_duration`。
- **monoCode**（Tauri+React）：`src/features/sessions/ui/AgentTranscript.tsx`（5479 行）行分类最全：`ActivityToolRow` / `ActivityThinkingRow` / `ActivityStatusRow` / `ActivityNoteRow` / `PhaseStep`（连续调用折叠成阶段）/ `SubagentStack` / `ApprovalControls` / `PlanPreview` / `TurnMetricsBadge`；`wordFade.tsx` 有节奏化流式（320ms、120–400ms 自适应、`prefers-reduced-motion` 关闭）；**计时在等待审批时暂停**（`useElapsedFrom(startedAt, paused)`）；子 agent 刻意排除在折叠 trail 之外。
- **acp-components**（React+Zustand，最接近"可直接抄的 ACP 卡片"）：`packages/react/src/components/chat-view/ToolCallCard.tsx` 的 `kindIcon` 直接按 `ToolKind` 映射、header 是 `<button aria-expanded>`、`LocationChip` 显示 `basename:line` 且键盘可达；`PlanView` 显示 n/m 与进行中 spinner；`ThoughtView` 流式时自动展开、结束后自动折叠。
- **agent-shell**（Emacs，23 个 agent）：编辑器原生而非聊天框的参考。
- **Exo / necoder / Athas / Alchemist / Bellows**：并行 worktree、注册表一键装、实时 agent 树、共享会话——属于 v0.7+ 的团队形态参考。
- **通用模式**：行五槽（图标/动词/目标 chip/状态/展开）；弱标题兜底（monoCode 的 `isWeakToolTitle` + 组合标题）；失败行永不折叠；审批行永不折叠；流式思考结束后自动折叠；成本徽标放回合头，不放全局底栏；行是 button、chip 键盘可达、流式 `role="status"`。

## 5. 路线（按版本，含验收）

### v0.2 视觉与事件对齐（1–2 周）
- 工具行重做为 DSH `ToolRow` 同构（无边框、14px 图标、单行标题+等宽摘要、右侧脉冲/勾/叉+耗时、展开区无边框）。
- 计划折叠为一行 `计划 n/m`，展开 checklist；diff 去卡片。
- 权限卡改为行内 chip（含 pending 黄条），保留只读语义。
- 修「深度求索中」计时（先采样确认三种假设），把 ACP 计时落到插件记录节点。
- `usage_update.cost` → 回合成本徽标；`session_info_update.title` → DSH 会话标题（如果可写）。
- **验收**：Claude Code + Codex 两个会话，视觉与原生工具行同屏不可分辨；`vitest` 覆盖行模型快照；截图进 `docs/`。

### v0.3 控制面（2 周）
- `available_commands_update` → `commandUi.register` 动态 `/命令`（提交时按 ACP 约定把 `/name args` 当 prompt 发出）。
- `config_option_update` + `session/set_config_option` → 模型/effort 选择器接 composer chip；`set_model` 作为探测到的扩展回退。
- `current_mode_update` + `set_mode` → 模式 chip。
- 每回合 token 差分 + 成本；`notice` 渲染为系统行；`compaction_update` 渲染压缩行。
- **验收**：三个 agent（Claude/Codex/OpenCode）分别在 UI 里切模型、切模式、跑 `/compact` 等命令成功；无能力时 chip 自动隐藏。

### v0.4 会话生命周期（2 周）
- 按 DSH sessionId 持久化绑定（agent、acp sessionId、cwd、model、consumed ids）到插件存储。
- `session/list` / `resume` / `load`（v1 形状）支持重启恢复；不支持时回退当前"全量上下文重放"。
- `session/fork` / `delete` / `new` 生命周期与 DSH 会话删除/复制对齐；`close` 保证幂等。
- **验收**：重启桌面端后同一 DSH 会话继续 ACP 上下文；agent 不支持 resume 时提示"上下文将重放"。

### v0.5 富内容与交互（2–3 周）
- 图片/音频 content chunk → 附件行；`resource_link` / embedded resource 的 prompt 发送。
- `elicitation/create` → 模态表单（复用 `ask-question-row` 的交互语言），URL 模式显示目标 host。
- 权限卡按钮接线：host 暴露 `acp/respondPermission` RPC，client 卡片直接答复；策略三档（always→自动允许、never→自动拒绝、ask→内联卡）；与 DSH 原生审批框二选一，不重复弹。
- **验收**：Claude Code 的 elicitation 与权限按钮端到端；截图 + 权限拒绝路径测试。

### v0.6 多 agent 与子会话（3 周）
- ACP 子会话：v1 `subagent_update`（unstable）与 v2 child-session 双形状；父 transcript 渲染嵌套卡（`N steps, M failed`），不并入折叠组；权限上提到根会话。
- ACP agent 作为 DSH 子 agent / teammate 跑，父会话显示 `DetailsRow` + 子会话树。
- **验收**：Codex/Claude Code 的 subagent 任务在 DSH 里可展开、可跳转。

### v0.7 能力面与注册表（2–3 周）
- **不做** v1 `fs/*` / `terminal/*`：v2 已整体移除，方向是"客户端把工具当 MCP server 暴露给 agent"；继续走现有 MCP 透传。
- 认证：`authenticate` + `authMethods`（env / terminal / API key），设置页按 agent 存 env；敏感值只写凭据库。
- ACP registry 集成：设置页 Discover，"一键安装"映射 `distribution`（npx/uvx/binary + sha256 校验），写 profile 的 agent 配置。
- `mcpCapabilities` 协商（http/sse）与 `session.notices` 能力门槛。
- **验收**：从 registry 装一个此前没配过的 agent（如 Gemini CLI）并跑通一轮。

### v0.8 分发与打磨（1–2 周）
- npm 发布 + DSH plugin market 索引条目（`index.json` 格式见 `packages/boot/plugin-market`），安装/升级走 Discover。
- 设置页：agent CRUD、`forwardMcp`、权限策略、语言。
- CI 矩阵：mock agent 协议一致性（14 种 update × 能力排列）、`tsc`、`vitest`、夜间真 agent 冒烟（Claude/Codex/Gemini/OpenCode/Goose）。
- 文档：README、`docs/architecture.md`、本路线图、故障排查（含"完全权限预设 → ACP 权限被自动拒绝"这一坑）。

### v1.0 稳定（持续）
- ACP v2 协商（稳定后切换）：双形状读取、`state_update`（前景/后台双维状态）、`plan_update`。
- 上游提案（见 §7）。
- 语义化版本 + 兼容矩阵 + 变更日志；性能门槛（记录 append 不阻塞流、单会话 1k 工具调用下 UI 仍 60fps）。

## 6. 架构演进

**Host**
- `AcpAgentRegistry`：按 provider 缓存 `initialize` 结果（agentInfo.version 作 key），能力探测（configOptions/commands/modes）缓存到插件设置，agent 升级自动失效。
- `AcpSessionStore`：`dshSessionId → {agent, acpSessionId, cwd, model, consumed, createdAt}` 持久化，替代当前纯内存 `bindings`。
- `record-sink` 升级到记录 schema v2（`version` 字段 + 迁移），upsert 语义（toolCallId/planId 幂等），写失败仍静默禁用但打点。
- 记录量控制：tool content 8k / output 20k / diff 4k 截断保留（已有），新增合并窗口（同 callId 100ms 内 update 合并）。
- 错误模型：`AcpFailureStage` 扩展（auth / config / resume），对外统一 `LlmError` code。

**Client**
- 节点：`acp-tool-call`、`acp-plan`、`acp-permission`、`acp-notice`、`acp-compaction`、`acp-worker`、`acp-subagent`。
- 共享 `AcpRowModel`（variant/title/target/summary/state/duration/body），host 与 client 各自可测；行渲染器只消费 model。
- composer：模式/模型 chip 走 `conversation.input.dock`；命令走 `commandUi.register`；权限按钮走 host RPC。
- 右栏：ACP 计划可选复用 `sidebar.right.pane.tab`（对齐 DSH plan mode）。
- i18n：新增键全部进 `zh`/`en`；时间/成本用 `Intl`。

## 7. 要向上游提的（DSH / ACP）

1. **DSH**：外部 agent 的"工具行"渲染扩展点（让 `plugin:*` 记录能用原生 `ToolRow` 渲染），比每个插件自绘更可持续。
2. **DSH**：插件可注册的审批答复通道（现在插件只能经 `ctx.approval`，客户端无法直接答）。
3. **ACP**：回合级 token 用量（RFD `end-turn-token-usage` 已在讨论）；`rawInput` 反序列化丢数据的 issue #1979；子会话 RFD 的稳定化。
4. **ACP registry**：增加能力矩阵或探测端点（目前只能运行时探测）。

## 8. 明确不做

- 伪造 `tool/call` / `tool/result` 事件冒充原生工具（语义假、易碎、污染日志）。
- 按 agent 名字硬编码 UI/特性（只认协议声明）。
- v1 的 `fs/*` / `terminal/*` 客户端能力（v2 已移除；改走 MCP）。
- 自绘终端仿真器（DSH 有 jobs/terminal 行，ACP 的 terminal content 走只读输出）。
- 在 v2 稳定前把它当默认协议。

## 9. 风险

| 风险 | 影响 | 对策 |
|---|---|---|
| DSH 内部 API 漂移（`appendPluginRecord` 非公开契约） | 记录失效 | 能力探测 + 失败降级为 reasoning 文本；锁 DSH 版本范围；上游提案 |
| ACP agent 私有扩展（`_meta.jetbrains.air.*`、`set_model`） | 隐藏功能拿不到 | 探测式使用，缺失即降级；文档标注 |
| 热重载 provider 泄漏（已验证） | 需重启桌面端 | 文档写明；长期用 bundle 重载而非禁用/启用 |
| 审批策略 never 导致 ACP 请求被拒 | 空响应 | 已在 README 写明；v0.5 权限接线时按策略映射 |
| v2 迁移 | 返工 | 记录 schema 留 `protocolVersion` 字段，读取层同时接受 v1/v2 形状 |

## 10. 下一步

1. v0.2 开工：先采样「深度求索中」计时（确认 startTime 假设），同时重做 `record-nodes.tsx` + `styles/records.ts`。
2. v0.3 的模型切换先改成 `set_config_option`（对齐 DSH 自己的 ACP server 做法）。
3. 把 `docs/acp-ecosystem-survey.md`、本文件、E2E 截图一起提交，作为公开仓库的"设计与调研"底稿。
