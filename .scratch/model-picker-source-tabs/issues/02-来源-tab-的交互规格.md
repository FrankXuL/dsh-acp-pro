<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-model-picker-source-tabs-v1-child-ux -->
<!-- DSH-CREATED: 2026-10-27T13:47:48.812Z -->
<!-- DSH-BLOCKED-BY: 06 -->
<!-- DSH-ASSIGNEES: lead -->
# 02: 来源 tab 的交互规格

Type: grilling

Blocked by: 06
Status: resolved
## Question

来源 tab 的交互规格：用户看到什么、怎么操作、边界如何表现？

（依赖「来源判定与配置热更新」研究票的结论；没拿到前不预设哪些 provider 能分出来。）

需要拍板：

1. tab 条目与顺序：DSH 固定第一，后面按什么排（配置键序 / 显示名 / 最近使用）；tab 标签用 displayName 还是路由名。
2. 默认选中：打开时落在当前模型所在 tab；当前选择落在已停用 ACP 时怎么办。
3. 一个 tab 内多模型：保留原生目录顺序，还是按模型名 / 最近使用排；搜索框是只搜当前 tab 还是跨 tab。
4. 空 tab / 失败 tab：ACP 一个模型都没公布、catalog 失败行、模型发现中，tab 是否还出现、怎么显示。
5. 切换语义：点 tab 只是切换可见列表，还是立即切模型；切换后未确认/失败如何回滚；effort 是否随模型重置。
6. 锁定态（生成中 / 会话不可切换）与禁用行怎么表达。
7. 键盘与无障碍：tab 列与列表的双栏焦点模型、方向键 / Enter / Esc、屏幕阅读器标签。
8. 非 ACP 第三方 provider 归到哪个 tab（DSH / 其他 / 单列）。
9. `/model` 弹窗仍是原生无 tab：是否需要在自绘选择器里提示“该入口不分组”，或提供跳转。

## Comments

### local — 2026-10-27T13:59:01.744Z
研究输入（来自已关闭的 #03 与 #06，先读 `docs/design/model-picker-shadow-contract-2026-10-27.md` §五/§九/§十 与 `...source-classification...md` §九）：

- tab 只能建在同一份 `ModelDirectory` 之上（与 `/model` 共实例），tab 只是 `groups` 的过滤视图；tab 集合以 `groups` 为准，避免两条通知瞬时不一致造成空 tab。
- tab 顺序：`DSH` 固定第一，ACP 按 `displayName` → `route` 稳定排序（不要承诺跟 YAML 键序；纯键序重排甚至不触发 replace）。
- **影子会让 `conversation.input.model.label` 失效**：第三方徽标静默消失，本票需拍板「接受 / 自绘行内徽标替代 / 放弃」。
- 非 ACP provider（`llm-pi-ai` 等）建议归 `DSH` tab，label 写 `DSH` 不写「原生」；若要单列，数据也够。
- 键盘建议：Tab/Shift+Tab 走 tab 条、↑/↓ 只走行；tab 的 aria 结构上游没有先例，需本票新定义。

### local — 2026-10-27T15:42:24.301Z
本会话开始 grilling 本票（wayfinder：一 session 只解一张票）。按 tab 构成 → 默认/切换 → 列表行为 → 键盘/锁定 → label 徽标与 /model 口径 的顺序收敛。

### local — 2026-10-27T15:48:48.570Z
## Answer（grilling 定稿，2026-10-27）

八问全部收敛，决策如下：

1. **tab 构成**：`DSH` + 每个已启用 ACP 各一个 tab；非 ACP 第三方 provider（`llm-pi-ai` 等）全归 `DSH` tab。`DSH` 固定第一，ACP 段按 `displayName` → `route` 稳定排序；tab 的身份用 route，标签用 displayName。
2. **默认选中**：每次打开跟随当前模型所在 tab；当前选择落在已停用/已移除的 ACP 时没有对应 tab → 落到 `DSH`，并在 trigger / 菜单顶部提示「当前选择已停用，请重选」。不跨会话记忆最后浏览的 tab。
3. **切换语义**：点 tab 只过滤列表，不提交；点模型才 `session/selectModel`。切 tab 不影响当前模型与 effort；选新模型按原生规则应用其默认 effort；pending 行禁用、失败 toast 且菜单不关，全部沿用原生。
4. **列表与搜索**：模型保持 `groups[].models` 的原生目录顺序，不额外排序；搜索只过滤当前 tab（tab 即范围）。
5. **失败 tab**：`failures[]` 中能对上本插件路由的 ACP 保留 tab + 警告标识，点开显示失败原因、模型行不可选；空 tab 不出现（Host 过滤 0 模型组 + ACP `listModels` 保底 default 模型）。
6. **键盘与锁定**：tab 条用 roving tabindex + `aria-selected`，`←/→` 在 tab 间移动、`Enter/Space` 激活；`Tab` 在「tab 条 ↔ 模型列表」之间移动；列表沿用原生 `↑/↓` 高亮 + `Enter` 选中；`Esc` 关闭菜单。`locked` 只禁 trigger，行仍可选（与原生一致）；被寻址 subagent 会话不渲染座位。
7. **徽标与 `/model`**：接受 `conversation.input.model.label` 在影子期间失效（第三方徽标静默消失）；`/model` 保持原生无 tab，不做额外提示；只在 README「限制」写一句两个入口的差异。
8. **tab 角标**：除失败 tab 的警告外不加运行中/停用角标（停用的 ACP 不出 tab；运行中由 composer 原生运行态/停止按钮表达）。

**实现输入**
- tab 集合以 `ModelDirectory.store` 的 `groups` 为准（真实存在的组才出 tab），来源分类用 configForms 的 `agents` 键集合；不要用两份通知各自枚举。
- 默认 tab 从 `current.provider` 找对应 group；找不到时落 `DSH` 并显示停用提示（#01 已定的 trigger 提示同一处文案来源）。
- 失败 tab 从 `failures[]`（id/name/message）映射到对应 ACP route；不可选、展示 message。
- 搜索复用 `rankByName`，输入集合限定当前 tab 的模型。
- 不声明 `conversation.input.model.label` 子插槽；tab 的 aria 结构需新定义（上游无先例）。
- 与 `/model` 共用同一份 `ModelDirectory`，两边选择状态天然一致。

**未实测**：均为源码契约与交互决策；实现后按仓库门禁 + README 真机验收（含 `/model` 未变更、tab 切换、失败 tab、键盘全链路）。

## Answer

tab = DSH + 每个 ACP（非 ACP 归 DSH，按 displayName→route 排）；默认跟随当前模型；点 tab 只过滤、点模型才提交；搜索限当前 tab；失败 ACP 保留错误 tab；双栏键盘；接受 label 徽标失效。

## 进度
