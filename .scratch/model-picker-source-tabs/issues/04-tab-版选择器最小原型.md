<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:prototype -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-model-picker-source-tabs-v1-child-prototype -->
<!-- DSH-CREATED: 2026-10-27T13:47:48.812Z -->
<!-- DSH-BLOCKED-BY: 03, 02 -->
<!-- DSH-ASSIGNEES: lead -->
# 04: tab 版选择器最小原型

Type: prototype

Blocked by: 03, 02
Status: claimed
## Question

用最小原型验证「左侧来源 tab 的模型选择器」在真实 DSH 里的观感与操作，别在规格里空想。

（前置：影子替换契约研究票 + 来源 tab 交互规格票。）

做法：在插件里加一个可丢弃的 `conversation.input.model` 影子实现，只覆盖：DSH / 每个 ACP 的左侧 tab、当前 tab 的模型列表、选中与 effort 的最小链路；搜索、键盘、失败行可以先粗糙。跑真实 DSH（桌面端 0.2.1-rc.3）截图/录屏，对照原生选择器，记录：

1. 双栏 tab 在 composer 弹层里的空间、层级、与输入框 / 工作区的关系。
2. tab 切换与列表滚动的手感；模型多时是否需要搜索。
3. 选中模型后会话头 / 触发按钮的显示是否与原生一致。
4. `/model` 弹窗与自绘选择器并存的割裂感是否可接受。
5. 键盘操作是否可达；锁定与生成中状态。
6. 原型代码保留/丢弃策略：只留截图与结论，代码不合并。

## 交付

原型分支/目录链接 + 截图 + 结论清单，回填到本票 Answer 与地图。

## Comments

### local — 2026-10-27T16:42:05.878Z
本会话开始处理本票（wayfinder：一 session 只解一张票）。原型目标按票面：影子注册生效、双栏 tab 观感/键盘、窄宽度收缩、subagent 不渲染、`/model` 仍原生且共享状态；代码只留结论，不合并。

### local — 2026-10-27T16:55:38.328Z
用户在验证中给出新的参考形态（截图）：左侧图标 rail（首个「收藏」★，其后每个来源一个图标），模型行右侧收藏按钮。按 wayfinder：这取代 #02 的「tab 标签用 displayName」，已新增 #07「模型收藏与图标来源 tab」承接收藏语义、持久化与图标来源；本票原型按该形态迭代（图标占位、收藏临时存 localStorage），仅用于目测布局与交互，不决定持久化。

### local — 2026-10-28T04:36:13.785Z
v2 未生效的定位（源码对照）：原生座位注册用 `ctx.inject(['slots', 'modelDirectories'], …)`（`deepseek-harness/packages/client/ui-model-selection/src/client/index.ts:168-194`），v2 的嵌套 inject 只列了 `modelDirectories`，回调里却访问 `slots` / `configForms` → 回调要么不执行、要么抛错，影子静默没注册上（刷新/重启后仍是原生选择器）。

v3 修正：inject 依赖改为 `['slots','modelDirectories','configForms']`；注册失败不再静默（`console.error` + error boundary 渲染「PROTO 渲染失败」）；另在 `conversation.input.left` 注册一个 10px 的「PROTO」诊断 chip，用来区分「bundle 没加载」与「座位注册/渲染失败」。已 `tsc`/137 测试通过并重建 dist，等待整机重启验证。

### local — 2026-10-28T04:44:30.012Z
原型 v3.1 已生效（用户截图确认）：图标 rail（★/D/字母）+ 搜索 + 收藏星 + 模型行选中态都渲染出来了。用户反馈两条：① 样式不好看，需要优化；② 打开应用侧边栏时会挡住面板。

v4 已改：普通内联样式换成 class sheet（hover/active/选中行/右侧勾选+收藏按钮/输入框/圆角与阴影都走 `--dsw-*` token）；单来源 tab 不再重复显示 provider 分组标题；弹层 `position: fixed` + `z-index: 2147483000`（试图盖过侧边栏），并按视口再夹一次 left/bottom；PROTO 诊断 chip 在注册成功后隐藏。图标仍是字母占位（正式图标来源归 #07）。待用户刷新复验样式与侧边栏遮挡。

### local — 2026-10-28T04:48:17.285Z
按「样式重新设计 / 交互别扭 / 去掉无意义文字」重做 v5：

- **删文字**：顶部来源标题（tab 名）、大写的 `EFFORT` 标题、底部 `prototype v4 · 收藏暂存 localStorage` 全部去掉；trigger 也不再显示 provider 名，只显示 `模型 · effort`。
- **搜索**：只在当前来源模型数 > 4 时出现（原生阈值），避免小列表也顶着一个搜索框。
- **图标**：字母 rail 换成 inline SVG——收藏 ★、DSH 菱形、按 displayName 关键词映射 Claude 星芒 / Codex 六边形 / Gemini 四角星 / DeepSeek 波浪 / Auto 闪电 / code 括号，未知来源回退首字母；不再是一排无意义字母。
- **Effort**：从整块列表改成模型列表上方的一行紧凑 chip（推理 [Light] [High] [Extra High]），仅当前模型有 reasoning 时出现。
- **尺寸/间距**：面板 440px 宽、最高 440px；rail 40px、行高与圆角收紧、收藏星更含蓄（hover 才亮）。
- 侧边栏遮挡仍用 fixed + 极高 z-index；若仍挡，说明祖先 stacking context，需换挂载方式。

待用户刷新复验。

### local — 2026-10-28T04:51:14.855Z
v6 按三条反馈改：

1. **模型 / 推理拆成两级**：点击先打开「模型」「推理」两行（原生 root 形态），各自下钻自己的 pane；推理不再出现在模型列表里。返回用 pane 头的 `‹` 或 Esc；选中即关闭。
2. **行高对齐原生**：菜单 padding 4px、行 `min-height:34px`、trigger 28px 高、字号 13/行高 20（对照 `ui-model-selection/ModelSelect.module.css`：root row 5px 7px、model row 34px、trigger 28px）。root 面板收窄到 280px，模型面板 440px。
3. **trigger 外显 ACP**：当前选择属于本插件 ACP 路由时显示 `ACP 名 · 模型 · 推理`（如 `Claude Code · Claude Opus 5.5 · High`）；DSH 原生模型仍只显示 `模型 · 推理`。

待用户刷新复验「点击先模型/推理」「行高」「ACP 外显」三点。

## 进度
