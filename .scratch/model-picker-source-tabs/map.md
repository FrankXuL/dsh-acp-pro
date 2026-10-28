<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 模型选择器来源 tab 与 ACP 启停 -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: wayfinder:map -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-model-picker-source-tabs-v1-map -->
<!-- DSH-CREATED: 2026-10-27T13:47:48.753Z -->


## Destination

模型选择器（composer 的 `conversation.input.model` 座位）里出现**左侧图标来源 rail**：第一个是「收藏」★，其后每个来源（DSH、每个已配置 ACP）一个图标 tab；模型行右侧有收藏按钮，可收藏/取消。每个 ACP 可在配置里启用/停用，停用后从选择器与 `/model` 消失。终点是一组已拍板、可直接进 `/to-spec` 的规格：替换方案与契约、来源判定、启停语义、收藏与图标、兼容与回退、验收标准。

## Notes

- 领域：DSH 插件（Host `src/host` + Web Client `src/client`）。模型选择器是 DSH 官方的 `conversation.input.model` 座位，插件侧只能影子替换（`priority` 更低者渲染），不能改原生选择器内部。
- 必读一手笔记：[`docs/design/dsh-model-picker-research-2026-10-27.md`](../../docs/design/dsh-model-picker-research-2026-10-27.md) —— 一句话结论：选择器无来源 tab 插槽；真 tab 只能整座替换或上游扩展；“逐 ACP 启停、关闭后只从选择器消失”可用 route 集合表达，但已保存选择会变 unroutable。
- 本轮研究笔记：[影子替换契约](../../docs/design/model-picker-shadow-contract-2026-10-27.md) —— 影子注册骨架、`modelDirectories` 数据面、原生行为清单、三条降级；[来源判定与热更新](../../docs/design/model-picker-source-classification-2026-10-27.md) —— 来源 = 自有 `agents` 键集合（零 host 改动）、`groups[].id` = route、`enabled` 必须放进 volatile `agents`。
- 用户已选路线：**插件侧整座替换**（真 tab）；接受 `/model` 弹窗仍是原生无 tab 版（两个入口外观不一致）；本图不推动 DSH 上游。
- DSH 源码：本机 checkout `/Users/xulilili/Downloads/闲聊/deepseek-harness`（0.2.1-rc.2，commit `687f282e`）；运行版是 0.2.1-rc.3（打包件 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`），引用 rc.2 的结论要在 rc.3 复核。
- 工程约束：每次改动后 `node node_modules/typescript/bin/tsc --noEmit` 与 `node node_modules/vitest/vitest.mjs run` 必须绿；客户端只能 require 平台种子词；样式只用 `--dsw-*` token；不伪造原生 `tool/call`，记录只用 `plugin:*`。
- 复用既有笔记时只记路径 + 一句话结论，不粘贴全文；新研究笔记写 `docs/design/`，路径回填到本图与对应票。
- 用户 #04 原型反馈（2026-10-28，截图）：左侧改成图标 rail，第一个 tab 是「收藏」★，模型行右侧有收藏按钮，可点击收藏/取消；该形态取代 #02 的「tab 标签用 displayName」，新增票 [模型收藏与图标来源 tab](issues/07-模型收藏与图标来源-tab.md) 承接。

## Decisions so far

<!-- 每关闭一张票追加一行：- [票名](链接) — 一句话结论 -->
- [影子替换模型选择器的契约与实现骨架](issues/03-影子替换模型选择器的契约与实现骨架.md) — 影子必须 `slots.inject` + `priority:-1` 且不声明子插槽；数据面复用 `modelDirectories`；`label` 徽标会失效；降级三条（静默 / 抛错回原生 / 崩溃 abdicate）。
- [来源判定与配置热更新](issues/06-来源判定与配置热更新.md) — 来源 = 自有 `agents` 键集合（`configForms`，零 host 改动），`groups[].id` = route；`enabled` 必须在 volatile `agents` 内；停用需显式回收子进程。
- [单 ACP 启停语义与设置页开关](issues/01-单-acp-启停语义与设置页开关.md): 软关闭 + 回合结束回收；选择器、`/model`、官方模型页隐藏，ACP Agents 行保留可重开；不改写已保存选择；`enabled` 默认 true 且 command 仍必填；开关只在编辑表单。
- [来源 tab 的交互规格](issues/02-来源-tab-的交互规格.md): tab = DSH + 每个 ACP（非 ACP 归 DSH，按 displayName→route 排）；默认跟随当前模型；点 tab 只过滤、点模型才提交；搜索限当前 tab；失败 ACP 保留错误 tab；双栏键盘；接受 label 徽标失效。

## Not yet specified

- 停用 ACP 后会话控制面板怎么显示（历史卡片已定：log-only 记录不受影响）。
- 窄视口/移动端的 tab 布局（键盘已定）。
- 中英文案（空状态已定）。
- 插件卸载/重装后的选择记忆与默认回退。

## Out of scope

- 修改 DSH 上游（本图只做插件侧；如需上游另立新图）。
- `/model` 弹窗内部改造（无法注入，且用户接受两个入口不一致）。
- 其他插件的模型选择器或 provider 改造。

## 进度

- 进度：66%（2026-10-27T23:49:00+08:00）：4/6 票关闭；#02 tab 交互定稿；frontier 变为 #04 原型、#05 兼容回退
- 进度：50%（2026-10-27T23:41:00+08:00）：3/6 票关闭；#01 启停语义定稿；frontier 变为 #02 tab 交互、#05 兼容回退
