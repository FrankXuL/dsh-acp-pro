<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 模型选择器：图标来源 rail、ACP 启停与模型收藏 -->
<!-- DSH-STATUS: done -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-8e29d6dd-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:56:42.949Z -->

# 模型选择器：图标来源 rail、ACP 启停与模型收藏

> 来源：wayfinder 地图 [`.scratch/model-picker-source-tabs/map.md`](../model-picker-source-tabs/map.md)（7/7 票已关闭）。本规格只把地图的决策折叠成可实施条目，不新增未拍板的决定。

## 1. 目标

把 composer 的模型选择器（DSH 官方 `conversation.input.model` 座位）替换为插件自绘的来源分组选择器：

1. **来源可辨**：左侧图标 rail 让用户一眼看出「这是平台（DSH）的模型」还是「这是某个 ACP 的模型」。
2. **ACP 可启停**：每个 ACP 可配置启用/停用；停用后从模型选择器与 `/model` 消失，设置页仍可重开。
3. **模型可收藏**：任何模型都能收藏，★ 收藏 tab 聚合常用模型。

## 2. 非目标

- 不改 DSH 上游：不新增 slot、不给 provider 加 `source` 字段、不推动上游 PR。
- 不改 `/model` 弹窗（原生、无 tab）；不试图让两个入口外观一致。
- 不改造其他插件注册的 provider 或它们的选择器。
- 不支持 0.1 核心（client 半边本来就不 apply，自然退回原生）。
- 不建自动化 e2e 基建；真机验收用一次性手工清单。

## 3. 现状与替换点

- 座位 `conversation.input.model` 由 `ui-conversation` 声明（`single` / `session`），`ui-model-selection` 只是普通注册者。
- 插件以 `priority: -1` 影子注册，优先级最低者渲染；不声明任何子插槽（因此第三方 `conversation.input.model.label` 徽标在本选择器内失效，已接受）。
- **inject 作用域必须包含** `slots`、`modelDirectories`、`configForms`、`sessions`、`remote`、`remote.session`。缺 `remote` / `remote.session` 时 entry 在渲染期抛 `cannot get property "remote.session" without inject`，引擎会静默退役该 entry 并回落原生——这是最隐蔽的失败模式。
- 数据面复用每会话唯一的 `ModelDirectory`（`modelDirectories.directoryFor(sessionId)`），与 `/model` 共用同一份 `current / groups / failures / pending`；**禁止**自建 catalog 或直连 `remote.session.modelCatalog()`，否则会产生第二个 pending/current 源。

## 4. 配置契约

```yaml
- id: dsh-acp-pro
  config:
    agents:
      cc:
        displayName: Claude Code
        icon: claude           # 新增，可选
        enabled: true          # 新增，默认 true
        command: /abs/path/claude-code-acp
    favorites:                 # 新增，顶层，与 agents 同级
      - provider: cc
        model: claude-opus-5-5
```

### 4.1 `agents.<route>.enabled`

- 类型 boolean，默认 `true`。YAML 与设置页写同一字段、走同一校验。
- `enabled: false` 时**仍要求 `command` 非空**（不做草稿态）。
- 必须位于 volatile 的 `agents` dict 内，保存即热更；放到 `agents` 之外会导致每次保存整插件重挂载。

### 4.2 `agents.<route>.icon`

- 可选字符串。取值优先级：
  1. 内置名 → 内置 inline SVG（`claude` / `codex` / `gemini` / `deepseek` / `openai` / `opencode` …）；
  2. 其他字符串 → 视作 emoji 或 URL（URL 走 `<img>`，受 web 壳 CSP 限制）；
  3. 未配置或非法 → 回退 displayName 首字母头像。
- 平台 tab 使用固定内置图标。

### 4.3 `favorites`

- 顶层 `favorites: [{ provider, model }]`，**volatile**。
- 只存 `provider` + `model` 身份，**不存可用性**；允许收藏已删除/已停用路由（只是不显示）。
- 不影响 `routeFacts` / reconcile：收藏变化不得触发 provider 重注册。

## 5. 行为规格

### 5.1 来源 tab（图标 rail）

顺序固定：`★ 收藏` → 分隔线 → `平台` → 各已启用 ACP（按 `displayName` → `route` 稳定排序，不跟 YAML 键序）。

- tab 集合以 `ModelDirectory.store.groups` 为准（真实存在的组才出 tab）；来源分类用 configForms 的 `agents` 键集合。
- 非本插件注册的第三方 provider 全归「平台」tab。
- 单个 ACP tab 不显示供应商分组标题；「平台」tab 与「收藏」tab 显示**吸顶**分组标题（`position: sticky` + 原生 `--dsw-alias-menu-group-header-fill`）。
- 失败的 ACP 保留 tab 并显示错误态（`failures[].message`），模型行不可选。
- tab 上除失败警告外不加运行中/停用角标。

### 5.2 两级 pane

点击 trigger 先出 **模型 / 推理** 两行（原生 root 形态，34px 行高），各自下钻：

- 「模型」→ 图标 rail + 搜索 + 模型列表（含收藏星）。
- 「推理」→ 当前模型的 reasoning 等级列表。
- 推理**不得**混进模型列表。
- 返回：Esc 回 root；无返回箭头。
- 选中即关闭菜单。

### 5.3 trigger 文案

`[ACP 名 · ]模型名[ · 推理等级]`——当前选择属于本插件 ACP 路由时前置 ACP 显示名；平台模型不前置。

### 5.4 搜索

- 全目录模型数 **> 4** 时显示搜索框（与原生阈值一致）；范围**只过滤当前来源**。
- 无匹配 / 空来源给出对应文案。

### 5.5 选择与推理

- 点 tab 只过滤列表、**不提交**；点模型才走 `directory.select()`。
- 切 tab 不影响当前模型与 effort；选新模型按原生规则应用其默认 effort。
- pending 期间：行禁用、trigger 显示进行态；失败 toast 且菜单**不关**。

### 5.6 收藏

- 模型行右侧 ☆，**默认透明、行 hover 时显示**；已收藏常亮 ★。
- 点 ☆ 只收藏/取消，**不选模型、不关菜单**，立即生效。
- 收藏 tab 按来源分组、组内保持目录顺序；空时显示引导文案。
- ACP 被停用时其收藏在收藏 tab 中**自动不显示**（目录已无该组），重新启用即回来，**不删数据**。
- 键盘：星是独立按钮、Tab 可达、Enter/Space 触发。

### 5.7 尺寸与材质（对齐原生）

- 卡片：模型 pane 固定 **340 × 360**（不超过原生 `max-width: min(420px, 100vw-32px)`、`max-height: min(360px, 100vh-96px)`）；root/推理 pane 紧凑宽度 240px、高度自适应。
- 列表在卡片内滚动，卡片尺寸**不随模型数量变化**。
- `border-radius: var(--dsw-radius-lg)`、`box-shadow: var(--dsw-elevation-prominent)`、`background: var(--dsw-menu-surface-fill)` + `--dsw-menu-backdrop-filter`。
- 行高 34px、padding `5px 7px`、字号 13/18、hover 用 `--dsw-alias-interactive-bg-hover`。
- trigger 28px 高。
- 只使用 `--dsw-*` token，不引入工具类 CSS。

## 6. ACP 启停语义

- **软关闭**：`enabled:false` 立即从 provider 注册表与可配置目录移除（不再允许新回合）；该路由**正在跑的回合允许跑完**；回合结束后回收子进程并失效该路由绑定。
- 无活跃回合时停用即回收；若在回合结束前重新启用，取消待回收、进程继续用。
- 可见性：模型选择器 tab、`/model`、官方「设置 → 模型」页全部消失；插件自己的 **ACP Agents 页保留该行**（只读「已停用」Tag），进入编辑可重开。
- 已保存选择不改写；选择器 trigger 提示「该 ACP 已停用，请重选」；发送时报 DSH 的 `session/model-unavailable`。
- 历史卡片不受影响（`plugin:acp/*` 是 log-only 记录）。
- 设置页开关**只在编辑表单**里（`Switch`），列表行不放行内开关、只保留只读徽标。

## 7. 实现清单

### Host

1. `src/host/config/schema.ts`：`AcpAgentProfile` 增 `enabled`（boolean，默认 true）与 `icon`（string，可选）；`Config` 增顶层 `favorites: z.array(...).default([]).volatile()`。
2. `src/host/apply.ts`：
   - `routes` 与 `directoryEntries` 只取 `enabled !== false` 的路由；
   - `routeFacts` 不纳入 `favorites`；
   - 新增 `retireRoute(route)`：无活跃回合 → `dispose()` + `invalidateBindings`；有活跃回合 → 标记待回收，回合结束再执行（**不能**靠过滤后的 `profiles()` 触发 `sync()`，那会立即中断回合）。
3. 适配器暴露「该 route 是否仍有活跃回合」的查询，供 `retireRoute` 判定。

### Client

4. `src/client/service/agents.utils.ts`：`profileOf` / `snapshotOf` 白名单携带 `enabled` 与 `icon`（否则编辑保存丢字段）。
5. 设置页编辑表单：`Switch` 绑定 `enabled`、`icon` 输入项；`types/dsh-client-ui-primitives.d.ts` 与 `tests/stubs` 补 `Switch` 声明。
6. 选择器组件（现 `model-seat-proto.tsx` 转正，改名并去 prototype 痕迹）：
   - 来源清单读 `configForms.get(PLUGIN_ID).getSnapshot().value.agents`；
   - 收藏读写走同一 `ConfigForm.mutate()`，不新增 host RPC；
   - 图标解析函数：内置名 → SVG，其余 → emoji/URL，未知 → 首字母。
7. 注册（现 `register/model-seat-proto.ts` 转正）：`slots.inject` + `priority:-1` + 不声明 children + 完整 inject 列表 + try/catch 回退 + error boundary。

## 8. 兼容与回退

- 只承诺 DSH **0.2 核心**（0.2.1-rc.3 已真机验收）。
- 三条自动回退：座位未声明（静默等待）、注册抛错（try/catch → 原生）、渲染崩溃（error boundary；引擎 abdicate 也只会回落原生，不连带 `/model`）。
- 不提供「回原生」配置开关。
- `/model` 差异只写 README「限制」。
- 升级复核：把「影子是引擎行为、非文档化扩展点、无版本协商」写入 `docs/dsh-plugin-dev/09-compatibility.md` 风险表，触发条件为 DSH minor 变更或 `ui-model-selection` / `ui-slots` 变更。

## 9. 验收

### 单测

- 渲染：rail 分组、单来源无分组标题、两级 pane、空态、失败 tab、锁定禁用 trigger、`available:false` 不渲染。
- 动作：fake directory 上 `select()` 携带 provider/model/effort；pending 态行禁用；失败不关菜单。
- 收藏：toggle 写入 `favorites`（fake ConfigForm），停用来源的收藏不显示。
- `this` 绑定：`ConfigForm` / store 方法以类实例形式注入（不能 unbound 交给 React）。

### 真机一次性清单

1. rail 出现（★ / 平台 / 各 ACP），切 tab 正常；平台 tab 有吸顶分组标题、单 ACP tab 没有。
2. 点击先出「模型 / 推理」两级；切模型后 trigger 更新；切到 ACP 模型 trigger 外显 ACP 名。
3. 搜索：全目录 > 4 时出现，只过滤当前来源。
4. `/model` 未变更；从 `/model` 选完，影子 trigger 同步。
5. 收藏：☆ 只收藏不选模型、收藏 tab 聚合、hover 才显星；重启后收藏仍在。
6. 停用一个 ACP → tab 消失、设置页行保留可重开、已保存选择报 `model-unavailable`；重新启用后 tab 与收藏回来。
7. subagent 会话不渲染座位；生成中 trigger 禁用。
8. 刷新页面 / 重启桌面端各一次，确认未回落原生（console 无 `slot entry crashed`）。

## 10. 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 影子是引擎行为 | 上游无版本协商，升级可能改排序/渲染规则 | 只依赖 `priority` 与 `slots.inject`；注册 try/catch；升级跑验收清单 |
| `label` 槽失效 | 第三方模型名徽标在本选择器内不显示 | 已接受；tab + 收藏承担来源表达 |
| inject 漏列依赖 | 静默退役、表现为「完全不生效」 | inject 列表写全；验收第一步查 console `slot entry crashed` |
| 卡片固定尺寸 | 390px 以上按设计宽度；更窄时靠 `max-width` 收缩（380px 已实测无溢出） | `anchorFor` 用视口减两侧 margin 兜底，并保留每 pane 的最小宽度 |
| `favorites` 写入频率 | 每点一次星写一次配置 | mutate 合并/串行；只在需要时写 |

## 11. 真机验收结果（2026-10-28）

在本机 DSH 0.2.1-rc.3 + web 壳上逐项验证：

| 项 | 做法 | 结果 |
| --- | --- | --- |
| 收藏持久化 | 在活体 DSH 点 ☆ 收藏模型，随后读 profile 配置 | ✅ `cordis.patch.yml` 出现 `favorites: [{provider, model}]`；收藏 tab 同步；重启不丢（写配置而非 localStorage） |
| 窄视口 | 600px 与 380px 两档压测卡片位置 | ✅ 600px：340×360 @ x=152（right=492<600）；380px：x=8（right=348<380），横纵向溢出均为 0 |
| URL / emoji 图标 | 直接跑 `resolveSourceIcon` 七种输入 | ✅ `https://` / 协议相对 / 相对路径 → url；emoji → emoji；内置名与 displayName 识别 → builtin |
| 面板跟随 | 拖动侧边栏与模拟 trigger 位移 | ✅ 逐帧跟随（直接写 DOM style，无过渡动画）；右对齐 trigger，不溢出视口 |
| 真实 provider 图标 | rail 与 trigger 实际渲染 | ✅ 平台用原生 fish 轮廓；ACP 用自带 provider mark（彩色 img / 单色 mask）；无 mark 回退首字母 |

**追加修复（验收中发现，已入库）**

- 拖动侧边栏时面板不跟随：`resize` / `ResizeObserver` 都不监听位置变化 → 改为面板打开期间逐帧比对 trigger rect，并直接写 DOM style 绕开 React 渲染；同时清掉面板继承的 `transition: all`。
- 内框越用越窄：夹窄后的实测宽度被当成下一帧输入，形成自我锁定 → 量宽度前先清 `max-width` 取自然宽度，`anchorFor` 增加每 pane 的 `minWidth` 下限，pane 切换丢弃过期测量。
- 面板相对 trigger 左对齐导致右侧溢出 → 改为右对齐（与原生选择器一致）。

**仍待补**

- 插件卸载/重装后的选择记忆与默认回退（边界行为，实现时定）。
- 中英文案：选择器文案当前硬编码中文，`t()` 化待补。
- URL 图标在严格 CSP 下的加载失败表现（本机 CSP 允许 data URI 与 https，未构造拒绝场景）。

## 收口

规格的 6 张实施票全部关闭（`e371943` / `d2dc778` / `36e54e5` / `0c221c0` / `66c137d` / `f99da57`），
真机验收结论见 §11，兼容复核已记录到 [`docs/dsh-plugin-dev/09-compatibility.md`](../../docs/dsh-plugin-dev/09-compatibility.md)。
本规格到此收口。

## 进度
