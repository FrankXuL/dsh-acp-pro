<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-model-picker-source-tabs-v1-child-toggle -->
<!-- DSH-CREATED: 2026-10-27T13:47:48.811Z -->
<!-- DSH-ASSIGNEES: lead -->
# 01: 单 ACP 启停语义与设置页开关

Type: grilling

Status: resolved
## Question

单 ACP 的「配置后开启/关闭」语义与界面边界：`enabled` 到底是什么、关掉之后哪些地方不显示？

需要拍板：

1. 字段与默认值：`agents.<route>.enabled`（默认 true）；关闭是否仍要求 `command` 合法；YAML 声明与设置页写入是否同一语义。
2. 隐藏范围：模型选择器（自绘 tab + `/model`）、设置页 ACP Agents 行、官方「模型」设置页、当前会话面板——各自显示 / 隐藏 / 灰显哪一种。
3. 已保存选择落在被停用路由：发消息时阻止并提示重选 / 自动回退到 DSH 默认模型 / 允许发送但报错；是否需要在会话里可视化提示。
4. 运行中会话与进程：停用是否取消进行中的回合、是否回收子进程；历史记录与卡片是否仍可见。
5. 设置页交互形态：行内开关 vs 编辑表单开关；关闭状态徽标；与删除按钮的关系；导入 JSON 时 enabled 如何预览。
6. 顺序与稳定性：停用再启用后 tab / 排序是否复位；绑定存储是否受影响。
7. 文案与文档：README 配置表、限制、升级说明要写什么。

## Comments

### local — 2026-10-27T13:59:01.709Z
研究输入（来自已关闭的 #06 与 #03，先读 `docs/design/model-picker-source-classification-2026-10-27.md` §六、§九）：

- `enabled` 必须放进 volatile 的 `agents` dict 内（`src/host/config/schema.ts:46-48`），否则每次保存整插件重挂载；client 的 `snapshotOf/profileOf` 白名单要同步加 `enabled`。
- 停用若只从 `routes` 过滤，`acp-adapter.sync()` **不会**回收已 spawn 的子进程（`src/host/service/acp-adapter.ts:368-379`）——本票问题 4 必须先答「停用是否回收进程」。
- 停用后：组从 catalog 消失、`current` 保留、`routable:false`、设置页行仍 `active:false`（可重开）。已保存选择的降级只有「阻止并提示」或「回退 DSH 默认」两条真实选项。
- 需拍板：停用是否回收子进程；已停用路由上的当前选择是阻止还是回退。

### local — 2026-10-27T15:37:43.544Z
本会话开始 grilling 本票（wayfinder：一 session 只解一张票）。先处理「关闭」的运行语义，再依次收敛隐藏范围、已保存选择、字段校验、设置页形态、稳定性与文档。

### local — 2026-10-27T15:40:43.584Z
## Answer（grilling 定稿，2026-10-27）

五问全部收敛，决策如下：

1. **关闭语义（软关闭 + 回合结束回收）**：`enabled:false` 立即从 provider 注册表与可配置目录移除（不再允许新回合）；该路由正在跑的回合允许跑完；回合结束后回收该 ACP 子进程并失效该路由绑定。没有活跃回合时停用即回收；停用后又在回合结束前重新启用，则取消待回收、进程继续用。
2. **可见性**：模型选择器（自绘来源 tab）、`/model`、官方「设置 → 模型」页全部消失；插件自己的 **ACP Agents 页保留该行**（只读「已停用」Tag），进入编辑可重新开启。我们的页面读 ConfigForm，不依赖可配置目录，所以目录条目可以安全移除。
3. **已保存选择**：不改写任何会话的选择；自绘选择器 trigger 上提示「该 ACP 已停用，请重选」；真正发送时由 DSH 报 `session/model-unavailable`。不自动回退（避免伪造 DSH 的 `model/selection` 事件）。
4. **字段与校验**：`agents.<route>.enabled`，boolean，默认 `true`；YAML 与设置页写同一字段、走同一校验；`enabled:false` 时 `command` 仍必须非空。
5. **设置页形态**：开关只在**编辑表单**里（DSH primitives 的 `Switch`；本仓 `types/dsh-client-ui-primitives.d.ts` 与 `tests/stubs` 需补声明）；列表行不放行内开关，只保留只读「已停用」Tag。
6. **重开与顺序**：tab 顺序仍按 `displayName` → `route` 稳定排序（#06 结论）；绑定已失效，旧会话重开后按新 ACP 上下文处理（有 `loadSession` 能力时按现有恢复逻辑，不保证 ACP 内部状态）。
7. **文档**：README 配置表补 `enabled`；「限制」写清隐藏范围、进程回收时机（回合结束后）、绑定失效与重开语义。

**实现输入（来自 #03/#06 研究）**
- `enabled` 必须加在 volatile 的 `agents` dict 内；client `snapshotOf/profileOf` 白名单、`EDITED_KEYS` 要同步携带，否则编辑保存会丢字段。
- reconcile：`routes` 与 `directoryEntries` 都只取 enabled；对应 replace 会发 `llm/adapters-updated`，客户端 catalog 自动重拉。
- adapter 不能简单用「过滤后的 profiles」触发 `sync()`（会立即中断回合）；需要 `retireRoute(route)`：无活跃回合→立即 dispose + `invalidateBindings`；有活跃回合→等该 route 回合结束再回收。
- 历史卡片不受影响：`plugin:acp/*` 是 log-only 记录，停用不删历史。

**未实测**：以上均为源码契约与设计决策；实现后按仓库门禁（`tsc --noEmit` + `vitest run`）与 README 的真机验收步骤验证。

## Answer

软关闭 + 回合结束回收；选择器、`/model`、官方模型页隐藏，ACP Agents 行保留可重开；不改写已保存选择；`enabled` 默认 true 且 command 仍必填；开关只在编辑表单。

## 进度
