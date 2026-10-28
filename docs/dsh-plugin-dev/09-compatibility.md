# 09 — Compatibility evidence and implementation status

核验日期：2026-10-26。本页区分源码契约、mock 验证和实际应用验收；安装了应用不等于插件已在其中通过验收。

## 当前证据

| 环境 | 已核验 | 未核验 |
| --- | --- | --- |
| 本机链接的 DSH checkout | `HEAD=687f282e`，工作区干净；此前核验的 peer 包为 `0.2.1-rc.2`。当前插件依赖由该 checkout 的 symlink 提供 | 不据此推断官方 app 包内代码完全相同，也不据此扩大支持版本范围 |
| 官方 DeepSeek Harness app | bundle `com.deepseek.dsh`，版本 `0.2.1-rc.3`；签名完整性检查通过，应用正在运行 | 尚未完成此插件的安装、加载、原生 UI 验收；RC 不代表稳定 API 承诺 |
| DSH Tauri app | 本机另有版本 `0.25.0` 的安装 | 未确认用户实际使用的是否为此应用，未验证插件加载和运行接口 |

已检查的官方 app plugin-management 根目录为空；旧指南的 `~/.dsh/profiles/desktop` 目录存在，但本轮未发现该位置的插件 link。这里只记录已观察路径，不据此断言其他位置不可能安装了插件。后续写入安装配置或重启应用前，需先明确用户使用的目标应用与 profile。

## 原生模型与思考强度链路

以下路径均相对上述 DSH checkout，而不是本插件的 `src/`：

1. `packages/api/session-controller/src/catalog.ts:20` 的 `buildModelCatalog()` 读取 `listModels()` 后，对每个模型调用 `resolveModelInfo()`。
2. `packages/llm/llm/src/index.ts:756` 的 `resolveModelInfo()` / `resolveModelInfoFor()` 直接调用 adapter 的 `resolveModel()`，核心层没有缓存；`resolveCallConfig()` 也使用该路径。
3. `packages/client/ui-model-selection/src/client/ModelSelect.tsx:95` 读取模型的 `reasoning.efforts/defaultEffort`，并在 `:408` 构造包含 `reasoningEffort` 的选择结果，`:637` 渲染选项。
4. `packages/api/session-controller/src/commands.ts:157` 处理选模型请求，通过 `resolveCallConfig()` 规范化并设置下一请求的选项。

Client catalog 自身有 generation 缓存：`ui-model-selection/src/client/catalog.ts:14`、`:47`；连接重置以及 adapters/settings/credentials 更新会触发失效（`service.ts:50`）。不能把这一层缓存当作 Host `resolveModel()` 已缓存的证据。

因此插件应按请求模型返回独立确认的 reasoning 元数据，并缓存其发现结果，避免每次目录刷新或模型解析都新建探测会话。模型元数据没有 sessionId，不能作为某个活动会话当前配置的权威状态。

## 扩展面与实施边界

| 能力 | 已有证据 | 当前决定 |
| --- | --- | --- |
| 宿主侧服务隔离 | 插件已有 `src/host/types/index.ts` 中的 `AdapterHost`，封装 agent、审批、图片和记录入口 | 继续使用此边界，不再平行创建另一套宿主抽象 |
| 输入区插槽 | DSH `ui-conversation/src/client/contract/slots.ts:269` 定义 `conversation.input.dock`；`ui-goal/src/client/index.ts:102` 有会话级注入实例 | 已注册会话配置面板；命令通过真实 `captureInsertion` / `insertText` 契约进入输入区，不自动发送。应用内交互待验收 |
| 双向 RPC | Host 使用真实 `TypertContribution`（schemas/model/invocations）与公开 `bindTypertRemote`；Client 使用匹配的严格描述符和 `$mount` | 真实 Typert Registry 注册/撤销及 Gateway 调用已通过；缺失扩展 API 时保留基础 provider。安装应用内的加载与调用待验收 |
| 会话持久化 | first-party Goal 的核心事件不是通用插件 KV API；插件使用自有原子 JSON 存储 | `profileContext.dir/data/dsh-acp-pro`，缺失时回退到 `$DSH_HOME/data/dsh-acp-pro`（默认 `~/.dsh`）；保存绑定、游标和未知状态，不保存完整对话或明文环境变量 |
| ACP 执行记录 | `appendPluginRecord` / Conversation Definitions 已被本插件使用 | 保持 `plugin:acp/*`、log-only；实验性边界仍需按实际 DSH 版本验证 |
| Models 页面提示 | 插件设置表单已有 `modelsHint` | 移除对上游 Models 页面 DOM 的 MutationObserver 改写，保留自有表单帮助 |

尚未完成实机验收，因此本轮不收窄 `peerDependencies` 为一个未经验证的版本范围，也不宣称支持所有 DSH 发行版。Typert protocol/registry 声明为可选 peer：前者按需加载，后者仅作类型约束；本地开发使用已有 checkout 包的 symlink，不据此假定发行版已提供对应 API。阶段验收仍遵循[路线图](../roadmap.md)。

## 本批代码的验证范围

已完成按模型隔离 reasoning 发现，以及取消 DOM 提示补丁。探测使用独立 session，目标模型返回的当前 effort 作为该模型 metadata 默认值；成功结果按连接代次、目录、模型缓存，重启后失效。关闭模型发现时不自动创建探测 session。取消后晚到的 session 会进入清理路径；远端关闭仍取决于 Agent 是否声明支持 `session/close`。

本批另实现 select 配置、模式、动态命令、持久绑定、能力驱动的 load、新会话边界、未知结果阻断，以及工具文件位置和 diff 跳转。权限请求必须关联当前进程与活动回合；恢复通知不重复生成卡片或计费。默认 smoke 仅检查握手与会话信息，不发送 prompt；未收到命令通知与空列表分别表示为 `null` 和 `[]`。

本地门禁与审查结果统一记录在[实施进度](../../.omc/plans/dsh-acp-evolution.md)；[实机交接](../dsh-verification-handoff.md)列出待验证的运行组合、原生选择器、面板、恢复和权限场景。本地检查不能替代官方 app 或 DSH Tauri 的实机验收。非 select 配置、v2、registry 安装及未实现的 fs/terminal 能力不在本批功能范围。

## 模型选择器影子替换（0.2 核心）

composer 的 `conversation.input.model` 座位由本插件以更低 `priority` 接管，自绘来源分组选择器（图标 rail + 收藏）。这不是文档化的插件扩展点，而是 slot 引擎的既有行为：

| 事实 | 证据 |
| --- | --- |
| 座位 spec 由 `ui-conversation` 声明，原生选择器只是注册者之一 | `packages/client/ui-conversation/src/client/apply.ts:458` |
| 同一 cell 内按 `priority` 升序渲染，最低者优先；同 priority 重复注册抛错 | `packages/client/ui-slots/src/index.ts:1138-1144`、`:1220-1223` |
| `slots.inject` 对未声明的座位静默等待，不算装载失败 | `packages/client/ui-renderer/src/client/registry.ts:194-271` |
| 渲染抛错会让该 entry 一次性退役并回落到下一个注册者 | `packages/client/ui-renderer/src/client/scoped-slots.tsx:1127-1134` |

**风险与已知陷阱**

- 没有版本协商 API：上游改动排序规则或座位声明方式时，影子可能静默失效（表现为「生成的菜单又变回原生」）。
- 依赖列表必须写全：entry 的 inject 作用域缺少 `remote` / `remote.session` 时，entry 在渲染期抛 `cannot get property "remote.session" without inject`，引擎退役该 entry 并回落原生——**没有任何用户可见报错**。排查第一步是看 console 里的 `slot entry crashed in 'conversation.input.model'`。
- 影子期间第三方 `conversation.input.model.label` 徽标失效（子插槽不能重复声明）。

**复核触发条件**：DSH 升级到新的 minor（0.2 → 0.3）或 `ui-model-selection` / `ui-slots` / `ui-renderer` 任一包有变更时，必须重跑规格里的真机验收清单（见 [`.scratch/model-picker-ui/spec.md`](../../.scratch/model-picker-ui/spec.md) §9），并把结论追加到本节。
