# DSH 模型选择器的来源分组与插件可扩展性（2026-10-27）

**检索对象：** 本机 DSH **0.2.1-rc.3**（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内 `/dsh`）。可读源码来自本机 monorepo checkout `/Users/xulilili/Downloads/闲聊/deepseek-harness`（**0.2.1-rc.2**，commit `687f282e`）；凡引用 rc.2 源码的结论，都在 rc.3 打包 bundle 里复核了同一行为。

**证据层级约定：**

| 层级 | 含义 | 本文标记 |
| --- | --- | --- |
| A | 源码契约：asar 打包文件 + 行号（或包内 README / typert 元数据） | `源码契约` |
| B | 本仓库 plugin dev 文档 / 既有笔记 | `plugin 文档` |
| C | 未在运行中的应用内验证（没打开 GUI 点过） | `未实测` |

> 本文所有"能/不能"都是**源码与契约层面**的判断，**不等于应用内验收**。GUI 行为（真实渲染、键盘、刷新时机）一律标 `未实测`。

## 结论摘要

1. **没有"左侧来源 tab"插槽，也不存在任何模型选择器内部的分区扩展点。** rc.3 打包客户端共声明 102 个 slot key，与模型选择相关的只有两个：`conversation.input.model`（composer 里的整个选择器座位，`single/session`）和 `conversation.input.model.label`（座位内部唯一扩展点，`single/session` + `inline`，只允许非交互内联内容）。`/model` 弹窗走 `commandUi` 的 `popupSelect`，没有插件插槽。
2. **分组标题就是 provider 的 `name`（ACP 路由即设置里的 `displayName`），渲染成吸顶标题（`MenuGroup`），不是 tab。** 顺序硬编码在客户端：`deepseek-account` → `deepseek-official` → 其余按目录顺序（= adapter 注册顺序）。插件无法改标题结构、无法改排序规则、无法插入自己的标题层级。
3. **目录与 provider 元数据里没有"来源/分组"字段可借用。** `ModelProviderGroup` 只有 `{id, name, models}`，`ModelCatalogModel` 只有 `{id, name, description?, reasoning?}`，`LlmProviderInfo` 只有 `{id, name}`，可配置提供方目录只有 `{provider, displayName, settingsNs, settingsPath, …}`。能表达"来源"的只有**一个自由文本：provider `name`/`displayName`**。
4. **插件单方面最接近的合法实现：** 给所有 ACP 路由的 `displayName` 加统一前缀（如 `ACP · Claude Code`）→ 分组标题天然成"来源"标记；注册顺序即组顺序，可把 ACP 组排成连续一段（但永远在 DeepSeek 之后）；再用 `conversation.input.model.label` 给模型行加非交互徽标。
5. **"逐个 ACP 启停、关闭后只从选择器消失、设置页保留"在现有契约内可完整实现**：启停只决定 `registerAdapter(replace(routes))` 的 route 集合，`registerConfigurableProviders(directory)` 保持不变。选择器在 `llm/adapters-updated` 上自动重拉；设置页行来自可配置目录（带 `active` 标记），所以仍可重开。**代价**：被关闭路由上的已保存选择会变成 unroutable，请求时失败——需要产品决策（提示 or 回退）。
6. **要真"左侧 tab"必须 DSH 上游扩展**：要么在选择器内部开一个插槽，要么在 `LlmProviderInfo`/`ModelCatalog` 里加 `source`/`category` 并让排序/分区消费它。插件侧唯一"绕过"方式是**整座替换**（用更低 `priority` 影子掉 `conversation.input.model` 再自绘一个带 tab 的选择器），技术上合法但要重写全部交互，且 `/model` 仍是原生无 tab 的版本——不建议作为本图的第一版形态。

## 一、选择器如何取目录、界面结构是什么

### 1.1 两个入口，一份会话级目录

- composer 的模型位与 `/model` 弹窗共用**同一个** `ctx.modelDirectories`（`ModelDirectoryResolver`）服务与同一个 `ModelDirectory` 实例；`directoryFor(sessionId)` 惰性解析、随会话 dispose。源码契约：`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:987-1042`（服务与 `directoryFor`）、`:1857-1911`（两个入口都经 `models.directoryFor(...)`）；包 README「Understand the implementation」同述。
- 目录数据来自 Host RPC `session.modelCatalog()`，不是客户端拼的。源码契约：`…/ui-model-selection/lib/client.js:752`（`this.ctx.remote.session.modelCatalog()`）、`:1006-1014`（`llm/adapters-updated` / `settings/document-updated` / 凭据事件 → `catalog.refresh()`）。
- 客户端**只做展示排序**，不重新分组：`state.groups` 原样来自 Catalog，只有 `orderModelProviders` 调整组顺序（见 1.3）。

### 1.2 目录从哪来（Host 侧投影）

`buildModelCatalog` 遍历 `ctx.llm.listProviders()`，逐 provider 调 `listModels()` / `resolveModelInfo()`，把失败隔离成 `failures`，并**丢掉 0 模型的组**：

- 源码契约：`@deepseek-ai/dsh-api-session-controller/lib/types/catalog.js:10-59`（`listProviders()` at 11、`listModels` at 14、空组过滤 at 52-53）。
- `listProviders()` 的注释写明返回"registration order"：`@deepseek-ai/dsh-llm/lib/index.js:1904-1910`。

### 1.3 UI 结构（composer 座位）

- 座位是两层菜单：根菜单只有 `Model` / `Effort` 两行，`Model` 行下钻到按 provider 分组的模型列表；每个组用 `MenuGroup` 吸顶标题渲染，标题文本 `group.provider.name`。源码契约：`…/ui-model-selection/lib/client.js:1636-1637`（`MenuGroup` + `label: group.provider.name`）；`:1152`（`ModelSelect`）。
- 组顺序函数（rc.3 里是明文、未压缩）：

  ```js
  // …/ui-model-selection/lib/client.js:1101-1108
  function orderModelProviders(groups) {
      return groups.toSorted((left, right) =>
          (left.id === "deepseek-account" ? 0 : left.id === "deepseek-official" ? 1 : 2)
        - (right.id === "deepseek-account" ? 0 : right.id === "deepseek-official" ? 1 : 2));
  }
  ```

  即：DeepSeek 账号第一、官方第二，**第三方保持目录顺序**；组内模型顺序不重排（同函数 1102-1107 注释）。
- `deepseek-account` 的组标题被客户端替换成本地化字符串（`provider.account`），其余组标题原样取 `provider.name`：`:1171-1177`。
- 搜索：>4 个模型才在座位菜单里出现搜索框；命中按"前缀 → 对齐分 → 目录序"排序，隐藏空组（包 README「Model and effort」）。
- 失败 provider 以不可选失败行出现（`/model` 里带 `option.loadError` 文案）：`:1815-1819`。
- `/model` 弹窗同源同序：`optionsOf()` 直接以 `group: { name: group.id, label: name }` 生成行，没有 tab、没有插槽：`:1801-1819`。

**会列出所有 provider 的模型吗？** 会——凡是 `listProviders()` 里有 adapter、且至少公布一个模型的 provider 都在列表里（空组被 Host 过滤）；已寻址 subagent 会话不暴露两个入口（README「Known Limitations」+ `directoryFor` 的 available 判定）。`未实测`。

## 二、slots 契约：与模型选择器相关的插槽

rc.3 打包客户端（`@deepseek-ai/*/lib/**/*.js`）里可枚举到 **102 个被声明的 slot key**（对运行时 `children` 声明表做正则扫描；以变量形式声明的键可能漏计，且不含框架 seed 的 `root`），其中含 `model` 的只有两个；`provider`/`picker`/`source`/`tab` 类 key 一个都没有（`tab` 只出现在插件管理页与右侧栏）：

| key | kind / scope | 声明者 | 用途 |
| --- | --- | --- | --- |
| `conversation.input.model` | `single` / `session` | `ui-conversation` | composer 工具行里的模型选择器**整座** |
| `conversation.input.model.label` | `single` / `session` + `inline: true` | `ui-model-selection` | 座位内部唯一的模型名扩展点 |

其余相邻但不覆盖选择器内部的插槽：`conversation.input.left`（list）、`conversation.input.right`（list）、`conversation.input.overlay`（list）、`conversation.input.dock`（list）、`conversation.composer`（chain，可整块替换 composer）、`settings.models.provider-card`（keyed，按 `settingsNs` 派发）、`settings.models.footer`（list）。

### 2.1 座位 `conversation.input.model`

- 声明与 owner props：`@deepseek-ai/dsh-client-ui-conversation/src/client/contract/slots.ts:298`（声明）、`:486-489`（`InputControlOwnerProps { locked: boolean }`）；rc.3 渲染调用 `…/ui-conversation/lib/client.js:19263`（`renderSlot("conversation.input.model", { locked: modelSeatLocked })`）。
- 座位内部由 `ui-model-selection` 注册（`…/ui-model-selection/lib/client.js:1900-1911`），并在同一次注册里声明子插槽 `conversation.input.model.label`（`:1907-1911`）。

### 2.2 唯一的内联扩展点 `conversation.input.model.label`

- 契约（包 README「Model label extensions」+ rc.3 声明 `:1907-1911`）：session 作用域、`single`、`inline`；**owner props** `provider: { id, name }`、`model`、`placement: 'trigger' | 'menu' | 'option'`、`selected`。
- 渲染位置：触发按钮 `:1517`、根菜单当前值 `:1550`、每个模型选项 `:1669`（同一 helper `:1463-1475`，外面包 `data-provider-id` / `data-model-id`）。
- 硬约束：**必须是非交互内联内容**（徽标、着色文本）；点击、搜索、焦点、勾选、禁用、Effort、无障碍文案都归选择器所有（README 同节）。
- **不覆盖 `/model` 弹窗**：`optionsOf()` 用 `label: model.name` 直接生成行（`:1801-1819`）。官方示例插件也确认这一点（`@deepseek-ai/dsh-client-ui-deepseek-model-label-1017/README.md`「Known Limitations」：`/model`、设置页、tooltip 保留原目录名）。

### 2.3 注册规则（决定"能不能顶掉座位"）

- 注册进未声明的 slot 会抛错；一个 key 只能有一个声明者；`single`/`keyed`/`list` 在**同一 priority** 重复注册会抛错（错误信息明说"register at a different priority to shadow it (lowest renders)"）。
  源码契约：`dsh-client-ui-slots`（仓库 `node_modules` 的 rc.2 副本）`src/index.ts:1138-1146`（shadowing 文档）、`:1210-1262`（校验与抛错）；rc.3 前端 shell bundle（`dsh-web-frontend/dist/assets/index-BXV-oxvX.js`）含同一错误串，证明 rc.3 行为一致。
- 因此**可以**用 `priority: -1`（更低者渲染）影子掉 `conversation.input.model`，用自绘组件替换整个选择器；但这是引擎层能力，**不是文档化的插件扩展点**，且 `/model` 弹窗不受影响。

## 三、目录/provider 元数据里有没有分组/来源字段

| 类型 | 字段 | 结论 |
| --- | --- | --- |
| `LlmProviderInfo`（`dsh-llm`） | `{ id, name }` | 无来源/分类；`name` 是选择器组标题的**唯一**来源。契约：`@deepseek-ai/dsh-llm/lib/typert.host.js:38-41` |
| `LlmModelInfo`（adapter 返回） | `{ provider, id, name, description?, inputModalities? }` | 无分组字段。契约：`…/dsh-llm/lib/typert.host.js:431-432` |
| `LlmConfigurableProvider`（设置目录） | `{ provider, displayName, settingsNs, settingsPath, declared?, defaultBaseURL?, baseURLEnv?, nativeAuth?, error? }` | 无顺序/分组字段；`displayName` 只给配置界面。契约：`…/dsh-llm/lib/typert.host.js:21-36` |
| `ModelCatalog` / `ModelProviderGroup` / `ModelCatalogModel` | `{ default, routableProviders, groups, failures }` / `{ id, name, models }` / `{ id, name, description?, reasoning? }` | 无 source/category/section。契约：`@deepseek-ai/dsh-api-session-controller/lib/typert.host.js:2571-2587`；RPC schema `:707-720` |
| `ProviderDirectoryEntry`（设置页 join） | 含 `active`（该 route 是否有 adapter）、`declared` | 设置页已能区分"声明了但没启用"。契约：rc.2 `ui-settings-models/src/client/store.ts:26-37`、join 顺序 `:45-60` |

**顺序由两段拼成**：(a) Host 的 adapter 注册顺序（`listProviders()` 的 Map 插入序）；(b) 客户端硬编码把 account/official 钉到最前。第三方之间只有 (a)，所以**同一插件的路由相对顺序可控**，跨插件只能靠加载顺序。

## 四、插件单方面能做什么（按"合法 + 成本"排序）

### 4.1 命名前缀（最接近"来源分区"）

`displayName` 会原样成为组标题（`deepseek-account` 除外）。把每条 ACP 路由的 `displayName` 写成 `ACP · <Agent>` 即可让所有 ACP 组在视觉上同源。证据：ACP 侧 provider 名 = `profiles().get(provider)?.displayName ?? provider`（`src/host/service/acp-adapter.ts:400`）；消费端 `:1171-1177` / `:1636-1637`。`plugin 文档` README 已说"模型选择器按 displayName 显示"。

### 4.2 排序

- 组顺序 = 注册顺序，ACP 插件已经在**一次** `registerAdapter(routes, adapter)` 里批量注册（`src/host/apply.ts:207`），`routes = [...snapshot.keys()]`（`:204`）——所以 ACP 组在"第三方段"内连续且顺序 = 配置快照的键序，可在 `reconcile` 里显式排序。
- 不能越过 DeepSeek：`orderModelProviders` 把 account/official 钉死在前（`:1108`）。

### 4.3 过滤模型

- 只能过滤**自己**的 provider：adapter 的 `listModels()` 少返回即可；返回空数组会让整组从选择器消失（Host 侧 `catalog.js:52-53` 过滤空组）。
- 无法过滤别人的 provider：`buildModelCatalog` 直接遍历 registry，没有中间钩子。

### 4.4 逐个 ACP 启停（与 Destination 的"关闭只从选择器消失"一致）

- 机制：`registerAdapter(routes, adapter)` 的 handle 支持 `replace(routes)`，`replace` 走同一条 `commitRoutes`，会发 `llm/adapters-updated`（`@deepseek-ai/dsh-llm/lib/index.js:1895-1903`；register/replace 共用 `:1847-1860`）。
- 关闭某条路由 = 从 `routes` 里去掉，但 **`registerConfigurableProviders` 的目录条目保留**：`src/host/apply.ts:103-111`（directoryEntries）、`:197-221`（reconcile 分别 replace 两个注册）。
- 效果链：provider 从 `listProviders()` 消失 → `modelCatalog()` 不再有该组 → 客户端收到 `llm/adapters-updated` 重拉（`…/ui-model-selection/lib/client.js:1006-1014`）→ 选择器里该组消失。设置页行仍来自可配置目录（含 `active: false`），因此**可重开**。源码契约齐全，`未实测`（没在 GUI 里开关过）。
- 边界：首次注册要求至少一条 route，但 `replace([])` 不校验非空（`@deepseek-ai/dsh-llm/lib/index.js:1842-1861`）→ 全部关闭也可表达，只要保留 registration 句柄。
- 设置页不会因为 `active: false` 隐藏行：`active` 只参与“能否直接发请求”的可用性判断（`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:1437-1440` 的 `providerUsable`），行本身来自可配置目录的 join。
- **副作用（必须在规格里决定）**：`modelAvailable` 以 `listProviders()` 判定可用（`catalog.js:67-78`），所以被关闭路由上已保存选择的会话会变 unroutable；包 README 说目录可用性不阻止发送，请求执行时才报错。产品上要么提示"该 ACP 已停用，请重选模型"，要么自动回退默认模型。

### 4.5 行级徽标（`label` slot）

可在三处（触发按钮、根菜单当前值、每个模型选项）把模型名替换成"带标记的内联内容"；但 `/model` 弹窗与设置页不生效，且不能交互。

### 4.6 整座替换（可行但不建议）

用 `priority` 影子 `conversation.input.model`，自绘一个带左侧 tab 的选择器：

- 需要的数据可通过 `ctx.remote.session.modelCatalog()` + `session.selectModel()` 取得（Host Remote 契约，`dsh-api-session-controller` 导出），不必依赖内部 `modelDirectories` 服务。
- 代价：要重写搜索、键盘导航、pending/失败行、Effort 行、无障碍；`/model` 弹窗仍是原生无 tab 版本，两个入口外观分裂；影子是引擎行为而非文档化扩展点，DSH 升级时风险高于普通注册。

### 4.7 明确做不到

- 在选择器内部加 tab / 分组标题 / 组内小标题；
- 改 `orderModelProviders` 的规则或让某来源置顶；
- 过滤或重排别的插件/内置 provider 的模型；
- 往 `/model` 弹窗里注入任何内容（它不读 `label` slot）；也不能再注册一个同名 `/model` 覆盖它——`ui-commands` 对重复的客户端贡献直接抛错（`@deepseek-ai/dsh-client-ui-commands/lib/client.js:1454`）；
- 让设置页的 provider 行顺序与选择器不同（两处都用同一"account → official → 目录序"规则）。

## 五、对本图的决策含义

1. **分组呈现形态（票 #2）**：在"纯插件 + 现状 DSH"约束下，可达形态只有**分组标题 + 统一 `displayName` 前缀 + 行徽标**；真左侧 tab 需要上游（在选择器内开插槽，或给 provider 加来源字段并让选择器消费）。
2. **"每个 ACP 可启停"**：不需要 DSH 改动。配置层加布尔 → `reconcile` 时 `routes` 排除该路由、`directory` 保留；选择器自动刷新、设置页仍可见。需要同时定义"已保存选择落在被停用路由上"的降级行为。
3. **不要用整座替换做第一版**：它会把"来源分组"变成"换掉官方选择器"，与地图里"设置页仍是原生入口"的假设冲突。
4. 如果上游接受扩展：最小改动是给 `LlmProviderInfo` 增加可选 `source`（或 `category`）并在客户端分组/排序时消费；其次是给选择器加一个 `conversation.input.model.source` 之类的 `list/keyed` 插槽。具体形态另开规格票。

## 六、未确认 / 未实测

- **未在应用内验收**：没打开模型选择器截图、没点过组标题、没验证开关后的即时刷新（全部为源码契约推断）。
- **rc.2 ↔ rc.3 版本差**：可读 `src/` 来自 rc.2 checkout；结论均在 rc.3 bundle 复核（`orderModelProviders`、`MenuGroup`、`optionsOf`、label 声明与三处渲染、Catalog schema），但 `data-provider-id` 之外对 CSS/视觉的差异未逐项比对。
- **`settings.models.provider-card` 在 ACP 的 `settingsNs` 下是否真能收到每张卡**：契约上 keyed 用 `ProviderDirectoryEntry.settingsNs` 派发，ACP 的 `settingsNs` 是 `llm-acp-pro`（0.1 核）或 Loader entry id（0.2 SettingsForms），源码见 `src/host/apply.ts:95-111`；未实测。
- **影子替换的真实运行表现**：引擎契约可读（rc.2 源码 + rc.3 shell bundle 错误串），但没写样例插件验证两个 single 注册的渲染顺序与焦点行为。
- **`/model` 弹窗在 provider 被移除后的失败行呈现**：读过代码路径（`:1815-1819`），未在 GUI 复现。

## 主要一手来源

- asar 内包（0.2.1-rc.3）：
  - `@deepseek-ai/dsh-client-ui-model-selection/{README.md, lib/client.js, locale/*}` — 两个入口、排序、label slot、目录服务。
  - `@deepseek-ai/dsh-client-ui-conversation/{README.md, lib/client.js}` — `conversation.input.model` 座位与其渲染点。
  - `@deepseek-ai/dsh-client-ui-commands/README.md` — `popupSelect` 的 `group: { name, label }` 契约（无 tab）。
  - `@deepseek-ai/dsh-client-ui-deepseek-model-label-1017/README.md` — 官方 `label` slot 示例及其覆盖范围限制。
  - `@deepseek-ai/dsh-client-ui-settings-models/{README.md, lib/client.js}` — 设置页 provider 行、`settings.models.provider-card` / `footer`。
  - `@deepseek-ai/dsh-api-session-controller/lib/{types/catalog.js, typert.host.js}` — `ModelCatalog` DTO 与 `buildModelCatalog` / `modelAvailable`。
  - `@deepseek-ai/dsh-llm/lib/{index.js, typert.host.js}` — `listProviders()` 注册序、provider/model/configurable-provider 字段。
  - `@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js` — rc.3 slot 引擎的 shadowing 错误串（压缩文件，用字符串定位而非行号）。
- 本机可读源码（0.2.1-rc.2，commit `687f282e`）：
  - `packages/client/ui-model-selection/src/client/{slots.ts, provider-order.ts, ModelSelect.tsx, index.ts, catalog.ts, directory.ts}`。
  - `packages/client/ui-conversation/src/client/contract/slots.ts`（座位声明与 owner props）。
  - `packages/client/ui-settings-models/src/client/{slot-contract.ts, store.ts}`。
  - `packages/client/ui-slots/src/index.ts`（注册/影子规则）。
- 本仓库（工作区）：
  - `src/host/apply.ts:95-215`（route/directory 注册与 reconcile）、`src/host/service/acp-adapter.ts:400`（provider 名 = displayName）。
  - `docs/dsh-plugin-dev/04-extension-points.md`、`docs/dsh-plugin-dev/09-compatibility.md`、`docs/design/acp-plugin-architecture.md`、`README.md`「模型提供方 / 配置入口」。
