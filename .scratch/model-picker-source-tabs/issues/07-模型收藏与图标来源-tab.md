<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-f0753eff-5977067 -->
<!-- DSH-CREATED: 2026-10-27T16:55:30.067Z -->
<!-- DSH-ASSIGNEES: lead -->
# 07: 模型收藏与图标来源 tab

Type: grilling

Status: resolved
## Question

模型选择器的「左侧图标来源 rail + 收藏」怎么定？

用户在 #04 原型反馈中给出参考形态（截图）：左侧一列图标 tab（第一个是「收藏」★，其后每个来源一个图标），模型行右侧有一个收藏按钮，点击收藏/取消。这个形态**取代 #02 里「tab 标签用 displayName」的决策**，并新增「收藏」能力。需要拍板：

1. **收藏粒度与范围**：按 `provider/model` 对一个收藏项；是否也允许收藏 DSH 原生模型；收藏是全局个人偏好还是会话级。
2. **持久化**：写插件配置（进 profile YAML / 设置同步、跨设备）vs 浏览器本地存储（localStorage，跨设备不同步、不进 profile）vs DSH 侧 store；是否需要跨设备。
3. **收藏 tab 的内容与顺序**：跨来源平铺还是按来源分组；排序（收藏时间 / 最近使用 / 目录序）；没有收藏时该 tab 是否显示。
4. **图标来源**：每个 ACP 的图标从哪来（配置 `icon` 字段 / 首字母或字母头像 / 统一 ACP 图标）；DSH 图标固定哪一种；图标缺失时的兜底。
5. **交互细节**：点星只收藏不选模型；收藏后菜单是否关闭；在收藏 tab 里取消收藏后条目是否立刻消失；键盘/屏幕阅读器可达性。
6. **图标 rail 的形态**：宽度、tooltip、`aria-label`、选中态；如何与 #02 已定的 tab 键盘规格（roving tabindex、Tab 进出列表）合并。

## 备注

- 依赖 #02 的 tab 交互决策；其中「标签用 displayName」被本票取代（tab 仍按来源分，但标签变成图标 + tooltip）。
- #04 原型会先按本票参考形态做一版（图标占位、收藏先用本地临时存储），用于用户目测；持久化与图标来源以本票结论为准。

## Comments

### local — 2026-10-27T16:57:42.818Z
原型观察（2026-10-28，#04 迭代）：DSH web 的端口每次启动会变（本会话内已见 59774 → 63182），而浏览器 `localStorage` 按 origin（含端口）隔离。所以**原型里用 localStorage 存收藏跨重启会丢**——正式实现不能把收藏放在 localStorage（至少不能只放那里）。持久化候选仍按票面：插件配置（volatile/设置同步）或 DSH 侧 store；需要跨设备就只剩插件配置/DSH 账号存储。反过来，这也说明「收藏」若要跨设备同步，写 `cordis.patch.yml` 的插件配置是最直接的路径，但会把个人偏好写进 profile。

### local — 2026-10-28T06:34:13.214Z
开始 grilling 本票（wayfinder：一 session 只解一张）。#04 原型已有可用形态：★收藏 tab + 行内 ☆ 收藏（localStorage 临时）；本票负责把收藏语义、持久化与图标来源定死。

### local — 2026-10-28T08:49:58.769Z
## Answer（grilling 定稿，2026-10-28）

1. **持久化 = 插件配置**（跨设备、跟 profile 走、重启不丢）。不用 localStorage（DSH web 端口每次变、origin 变就丢，已实测）。字段为**顶层 `favorites`**，与 `agents` 同级：`favorites: [{ provider, model }]`；该字段必须是 **volatile**，才能保存即热更（否则每次保存整插件重挂载）。
2. **范围与排序**：任何模型都能收藏（DSH 原生 + 每个 ACP）；收藏 tab **按来源分组**显示（带吸顶分组标题），组内保持目录顺序；收藏 tab 始终存在，空时显示引导文案。
3. **图标来源**：`agents.<route>.icon` 可选配置（内置名如 `claude` / `codex` / `gemini`、或 emoji / URL）；未配置 → 回退首字母头像；DSH 平台 tab 用固定内置图标。
4. **交互**：点 ☆ **只收藏不选模型、不关菜单**，立即生效；收藏 tab 里取消收藏 → 条目立即消失；收藏为空显示引导。键盘：星是独立按钮、Tab 可达、Enter/Space 触发（与 #02 的双栏键盘模型一致）。
5. **与启停的关系**：收藏只存 `provider/model`，不存可用性；ACP 被停用后其收藏在收藏 tab 中**自动不显示**（目录已无该组），重新启用即回来——**不删收藏数据**。

**实现要点（供 /to-spec 用）**
- Host：`config/schema.ts` 增 `favorites: volatile(array({ provider, model }))`；`assertProfiles` 不管收藏（允许收藏已删除的路由，只是不显示）。
- Host：`apply.ts` 的 `routeFacts`/reconcile 不因 `favorites` 变化而重注册路由（收藏只影响客户端渲染），避免无意义 churn。
- Client：收藏读写走 `ctx.configForms.get(PLUGIN_ID).mutate([...])`（设置页同一通路），**不要**另开 host RPC；收获后用同一 snapshot 自动刷新。
- Client：`snapshotOf` / `profileOf` 的白名单要携带 `favorites` 与 `agents.*.icon`，否则保存会丢字段（与 #01 的 `enabled` 同一坑）。
- 图标：内置名 → inline SVG 映射表；URL → `<img>`（受 CSP/离线限制）；未知 → 首字母。`icon` 值非法时静默回退首字母，不报错。

**未实测**：收藏写配置的保存延迟（设置页同款 mutate，理论上是热更）、URL 图标在 web 壳下的 CSP 行为。

## Answer

收藏写插件配置顶层 volatile favorites；任何模型可收藏、收藏 tab 按来源分组；icons 走 agents.icon 可选配置 + 首字母兜底；点星即时生效不关菜单；停用来源的收藏隐藏不删。

## 进度
