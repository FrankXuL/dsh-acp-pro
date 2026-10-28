# 来源判定与配置热更新（2026-10-27）

**本票范围：** 承接 [`dsh-model-picker-research-2026-10-27.md`](./dsh-model-picker-research-2026-10-27.md)（下称「前篇」）。
前篇已证明：`ModelProviderGroup` / `LlmProviderInfo` / 可配置目录都**没有** source 字段，组标题只能是 provider `name`。
本篇不再推导这些，只回答前篇没回答的：**自绘选择器的 client 侧凭什么判定「这条 catalog 组属于哪个来源」，以及配置改动后 tab 怎么保持新鲜。**

**检索对象与证据层级**（沿用前篇约定）：

| 层级 | 含义 | 标记 |
| --- | --- | --- |
| A | 源码契约：rc.3 asar 打包件 + 行号，或 rc.2 可读 `src/` 行号 | `源码契约` |
| B | 本仓库 plugin dev 文档 / 既有笔记 | `plugin 文档` |
| C | 未在运行的应用内验证 | `未实测` |

- 可读源码：`/Users/xulilili/Downloads/闲聊/deepseek-harness`（0.2.1-rc.2，commit `687f282e`）。行号若无特别说明均指这份源码。
- 打包件：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内 `/dsh/node_modules/@deepseek-ai/*`（0.2.1-rc.3）。本篇另从 asar 解出并逐行比对的一手文件：`ui-settings/lib/client.js`、`ui-model-selection/lib/client.js`、`dsh-settings/lib/index.js`、`dsh-llm/lib/{index.js,typert.remote-client.js}`、`dsh-api-session-controller/lib/typert.remote-client.js`、`dsh-base/cordis.patch.yml`；**这些文件的行为与 rc.2 源码一致**，下文标「rc.3 复核」。层级标记在正文里只用于表格判断列与「未实测」；所有 file:line 断言均属层级 A。

## 结论摘要

1. **「来源」只能靠客户端自己判定，判定基准是「本插件配置里的路由键集合」。** 插件 client 已经能拿到完整、schema 解析后的 `agents` 字典（路由键 + `displayName` + 全部 profile 字段），来源就是 `ctx.configForms.get(entryId).getSnapshot().value.agents`。这是本仓 `agents-section.tsx` 现在就在用的同一条路径，**不需要任何 host 侧新增面**。
2. **`ModelCatalog.groups[].id` 就是 `agents` 的键。** 不是推导：`prepareRoutes` 强制 `providerInfo().id === route`（否则抛 `INVALID_ADAPTER`），ACP 的 `providerInfo()` 直接返回 `{id: provider, name: displayName ?? provider}`。`group.name` = `displayName`。
3. **「停用」字段现在不存在。** `Config` 的 `agents` 是 `z.dict(AcpAgentProfile).volatile()`，profile 里没有 `enabled`；补这个字段**等于补一个 volatile 子树**，因此保存即热更、client 通过同一条 snapshot 立刻看到，不需要新的传输通道。
4. **热更新有三条触发源，但 `agents` 的改动最终都汇到同一条链路**：`loader/volatile-update` → `reconcile` → `registration.replace` → `llm/adapters-updated` → 客户端 catalog 重拉；同时并行的 `settings/document-updated` 刷新 ConfigForm snapshot。**两条通知不同源，存在瞬时不一致窗口**，规格上必须容错。
5. **YAML 手改也是热的**，不止重启：`hmr` 在 base bundle 里默认开启（`root: []` 只关模块热更，profile 配置热更默认开），它 watch 了 profile patch 文件，改 `agents` 走同一条 volatile 提交路径。`未实测`。
6. **原生 provider 只有两个稳定身份可判**：`deepseek-account`、`deepseek-official`。除此之外客户端**无法**枚举「内置 / 第三方插件」——`listProviders()` 只回 `{id, name}`，目录里只有 `settingsNs`/`declared`/`active`。兜底：**不是我们的 → 全归 DSH tab**（label 建议就叫 `DSH`，不要叫「原生」）。
7. **推荐方案**：tab 来源清单来自 `configForms` snapshot（客户端），组与选择状态来自目录服务或 `session/modelCatalog()`；tab 顺序在客户端显式排序；**不在 host 侧为排序新增任何东西**。

## 一、来源判定：可用 / 不可用字段

| 需要的信息 | 可用字段 | 判定 | 证据 |
| --- | --- | --- | --- |
| 我有哪些 ACP 路由（含已停用） | `ConfigFormSnapshot.value.agents` 的键 | ✅ 可用 | `ConfigFormController.derive` 把 Host describe 的 `value` 放进 snapshot：`packages/client/ui-settings/src/client/config-form.ts:181-204`；`value` 是 `projectForm(form, plainConfig(entry.fiber.config))`（schema 解析后的活配置）：`packages/settings/settings/src/index.ts:302-340`；`plainConfig` 负责拆 `Volatile` 包装、`projectForm` 按 schema 收窄：`packages/settings/settings/src/schema.ts:10-17,59-67` |
| 这个 ACP 的显示名 | `agents[route].displayName`（`?? route`） | ✅ 可用 | 本仓 `src/host/apply.ts:104-110`；`src/host/service/acp-adapter.ts:399-401` |
| 启停开-关 | **当前无字段**；需新增 `agents[route].enabled`（票 #01 拍板） | ❌ 现在拿不到 | `src/host/config/schema.ts:27-44`（`AcpAgentProfile` 字段表）、`:46-48`（只有 `agents` 是 volatile） |
| catalog 组属于哪个来源 | `group.id` ∈ 本地路由集合 → 我们；否则 → DSH | ⚠️ 推导，无 source 字段 | `packages/api/session-controller/src/catalog.ts:49-52`（`{id: provider.id, name: provider.name}`）+ 前篇第三节 |
| provider 是否「DSH 原生」 | 无来源字段；目录里只有 `settingsNs` / `declared` / `active` | ❌ 不可判 | `packages/client/ui-settings-models/src/client/store.ts:26-37`（`ProviderDirectoryEntry` 全部字段）、`:45-70`（join 只加 `active`） |
| 谁是某条路由的注册者 | 无 owner 字段；`listProviders()` 只回 `{id,name}` | ❌ 不可判 | `packages/llm/llm/src/index.ts:483-486`；`packages/api/remotes/src/remote-events.ts` 也无相关事件 |
| 组里有哪些模型 / 是否可路由 | `groups[].models[]`、`routableProviders` | ✅ 可用 | `catalog.ts:64-71` |
| 某 provider 加载失败 | `failures[] = {id, name, message}` | ✅ 可用（只有失败者，不含「未注册」） | `catalog.ts:53-62` |
| 该 provider 当前是否活跃 | `listProviders()` / catalog 里有没有这个组 | ✅ 可用 | `catalog.ts:24-25`；`store.ts:56`（`active: active.has(entry.provider)`） |

**关键取舍：** 判定不要走「provider 目录的 `settingsNs`」当唯一依据，虽然它同样能区分 owner（我们的目录条目 `settingsNs = settingsNsOf(ctx)`，见 `src/host/apply.ts:95-111`）。理由：`settingsNsOf` 在 0.2 核是 **Loader entry id**（回退 `PLUGIN_ID`），而 client 的 `ConfigForm` namespace 也是 entry id（`config-form.ts:284-293`）——两者是同一个不变量；但「我们的路由集合」直接从我们自己的配置读出来，**语义更直白、少一层跨插件假设**，且对「目录注册成功但 adapter 注册失败」的冲突有更好的失败模式（见 §八风险）。

## 二、client 侧拿 route 清单的可行路径

| # | 路径 | 拿到的层 | 刷新机制 | 成本 | 契约层级 |
| --- | --- | --- | --- | --- | --- |
| 1 | `ctx.configForms.get(entryId).getSnapshot()` | 路由键、`displayName`、全部 profile 字段（含未来的 `enabled`）、`user`/`base` 层 | 自带：`settings/document-updated` → 共享 mirror 重读 → `derive()` 换 snapshot，`subscribe` 通知 | **0**（本仓已注入 `configForms`，`agents-section.tsx` 已用 `useSyncExternalStore` 订阅） | `settings.section` 域的基础服务，文档化的插件协作面 |
| 2 | `ctx.remote.llm.listConfigurableProviders()` | 目录条目：`provider`/`displayName`/`settingsNs`/`settingsPath`/`declared` | 手动（要自己挂 `llm/adapters-updated` + `settings/document-updated`） | 低：只需在 `runtime.ts` 的 `LlmRemote` 加方法签名；`remote.llm` 已注入 | typert wire RPC（rc.3 复核：`dsh-llm/lib/typert.remote-client.js` 有该 descriptor） |
| 3 | `ctx.remote.session.modelCatalog()` | `groups` / `failures` / `routableProviders` / `default`（**没有**「是不是我们的」） | 手动（同上） | 低-中：要新增 `inject: 'remote.session'` + 类型投影 | typert wire RPC（rc.3 复核：`dsh-api-session-controller/lib/typert.remote-client.js:1668`） |
| 4 | `ctx.modelDirectories.directoryFor(sessionId).store` | 组 + `current` + `routable` + `failures` + `select()`（**与 `/model` 弹窗共享同一份状态**） | 自带：`llm/adapters-updated` / `settings/document-updated` / `credentials/*` → `catalog.refresh()`；`connection/reset` → `resetGeneration()` | 中：要新增 `inject: 'modelDirectories'`；该服务是 `ui-model-selection` 内部服务（非文档化扩展点） | 服务契约（`super(ctx,'modelDirectories')`） |
| 5 | 自有 host remote（如 `acpSessionControl.listRoutes`） | 精确的「本插件实际注册成功的路由」 | 手动 | 高：`shared/session-control-remote.ts` 加 descriptor + zod codec，host 加实现，client 加类型并挂载 | 自建 Typert contribution |

**证据：**

- 路径 1：`config-form.ts:284-293`（`get(entryId)` → `namespace: entryId`）、`:308-327`（`whileServed` 读共享 mirror 的已服务 namespace）、`config-form-types.ts:8-31`（snapshot 六字段：status/value/base/user/revision/writable）；刷新源头 `ui-settings/src/client/index.ts:41-46`（`settings/document-updated` + `connection/reset` → `mirror.load()`）。rc.3 复核：`dsh-client-ui-settings/lib/client.js:1209-1231`（`derive`）、`:1315-1337`（`whileServed`）同形。
- 路径 4：`packages/client/ui-model-selection/src/client/service.ts:37-58`（服务名 `modelDirectories` + 四条订阅）、`:66-90`（`directoryFor`）；`catalog.ts:47-99`（`load` / `refresh` / `resetGeneration`）；`directory.ts:19-35`（状态形状含 `current`/`routable`/`groups`/`failures`/`pending`）、`:157-198`（`syncInputs` 计算 `routable`）。
- 路径 4 的 seat 注入方式（对 #03/#04 关键）：`conversation.input.model` 的注册用 `inject: (sessionId) => {...}`（rc.3 `ui-model-selection/lib/client.js:1901-1916`），而 session 作用域 slot 的 factory 第一个参数就是 `sessionId`：`packages/client/ui-slots/src/index.ts:634-645`。
- 路径 3 的「无 host 改动」先例：`ui-settings-subagent` 就是 `inject: [... 'remote.session', 'configForms']` + `ctx.remote.session.modelCatalog()` 读目录，订阅两个失效事件刷新——`packages/client/ui-settings-subagent/src/client/index.ts:72-83`、`…/subagent-model-selection-card-controller.ts:315-331`。**这是本图最贴近的官方先例。**

**建议组合**：**来源清单走 1，模型与选择走 4**（内部服务，换来的收益是与 `/model` 弹窗共享同一份 `ModelDirectory` 状态，两个入口不会各选各的）；若不愿依赖内部服务，退化为 **1 + 3**（把 `select` 换成 `ctx.remote.session.selectModel`，`@Remote('selectModel')`，见 `packages/api/session-controller/src/index.ts:309-312`），代价是自己维护 `current`/`routable` 的判定（照抄 `directory.ts:157-198`）。

## 三、`groups[].id` ↔ `agents` 键 ↔ `displayName` 的完整链路

```
cordis.patch.yml  agents.<route>.displayName
        │
        ├─(a) 目录条目 displayName = profile.displayName ?? provider      apply.ts:104-110
        ├─(b) adapter providerInfo().name = displayName ?? provider       acp-adapter.ts:399-401
        │        └─ prepareRoutes 强制 info.id === route 且 name 非空     llm/src/index.ts:437-466
        │             └─ 注册表 provider = {id: route, name: displayName} :468-482
        │                  ├─ listProviders()  → {id, name}               :483-486
        │                  └─ buildModelCatalog → group{id,name,models}   catalog.ts:49-52
        └─(c) 设置页行 displayName（join 后）                              store.ts:45-70
```

结论：

- **`groups[].id` 就是 `agents` 的键**，不是推导：`prepareRoutes` 里 `if (typeof info.id !== 'string' || info.id !== provider …) throw INVALID_ADAPTER`（`packages/llm/llm/src/index.ts:437-466`），rc.3 复核同一错误串（`dsh-llm/lib/index.js:1874`）。
- **`groups[].name` = `displayName`**（未写 `displayName` 时回退成路由键）。客户端把非 `deepseek-account` 的组标题原样取 `provider.name`（前篇 §1.3）。
- **真实配置里 route 是 slug，不是显示名**：本机 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `agents` 键是 `cc / codex / oc / flick / agy`，`displayName` 才是 `Claude Code / Codex / OpenCode / MyFlicker / Antigravity`。→ **tab 的 label 必须用 `displayName`，tab 的身份（key/选中态）必须用 route**。
- **`displayName` 改名会热生效**：`routeFacts` 把 `[route, displayName ?? null]` 一起纳入比较（`src/host/apply.ts:113-115`），改名即 `facts` 变化 → `replace` → 组标题更新。**改路由键**（`saveOpsOf` 先 `unset` 再 `set`，`src/client/service/agents.utils.ts:188-194`）会换身份 → tab 视为另一个来源。

## 四、DSH 原生 provider 身份与兜底归类

客户端能拿到的「原生身份」只有两个硬编码常量（前篇 §1.3 的 `orderModelProviders`）：

| 路由 | 声明者 | 证据 |
| --- | --- | --- |
| `deepseek-account` | `llm-deepseek-account` | `packages/llm/llm-deepseek-account/src/index.ts:22`（`const PROVIDER`） |
| `deepseek-official` | `llm-deepseek-api-key` | `packages/llm/llm-deepseek-api-key/src/index.ts:15` |

除此之外：**无法枚举「内置 vs 第三方插件」**。

- `listProviders()` 只回 `{id, name}`（`llm/src/index.ts:483-486`，rc.3 的 result schema 同）。
- 可配置目录只有 `provider`/`displayName`/`settingsNs`/`settingsPath`/`declared`/`defaultBaseURL`/`baseURLEnv`/`nativeAuth`/`error`（rc.3 `dsh-llm/lib/typert.remote-client.js` 的 `llm_listConfigurableProviders_result` schema）；`declared` 的字段说明明确它只表示「adapter 是否因配置才认识这条路由」，**不是**归属。
- 同时 `llm-pi-ai` 也是「配置驱动注册路由」的家族（`packages/llm/llm-pi-ai/src/index.ts:246-269` 注册整目录、`:301-312` 由 profiles 生成 routes），所以「用户配置出来的路由」不能被当成「ACP」。

**兜底策略（推荐）：** 二值归类 —— `group.id ∈ 我们的 agents 键集合` → 该 ACP 的 tab；**其余一律进 `DSH` tab**（含 `deepseek-*`、`llm-pi-ai` 的路由、其他第三方插件）。`DSH` tab 内部保持原生顺序（account → official → 目录序，前篇 §1.3）即可，因为 tab 内不再需要有来源标题。

**label 用词：** 写 `DSH`，不要写 `DSH 原生` —— 归进去的 `llm-pi-ai` 路由是用户自己在 DSH 设置里配的，不是「原生模型」。

## 五、热更新链路

### 5.1 设置页保存（本仓当前唯一在跑的热更路径）

```
表单 mutate(ops)                                  config-form.ts:129-148
 → remote.settings.mutate(entryId, ops, revision)
 → SettingsForms.mutate → write                    settings/src/index.ts:367-378, 377-422
   → configEditor.edit(entry, ...)                 config-editor/src/index.ts:87-154
       ├ 写 profile patch YAML（writeFileAtomic）
       └ reconcileProfilePatches(root, patches, 'dsh', [entryId])
         → Loader Entry.update                     vendor/loader/src/config/entry.ts:118-160
             ├ volatileOnly 判定（非 volatile 字段全不变）  :146-150
             └ _commitVolatile                     :164-197
                 ├ updateVolatile(cell, candidate) → cell 换成新快照  vendor/cosmokit/src/volatile.ts:84-86
                 └ fiber.ctx.emit(self,'loader/volatile-update',paths)
 → 插件 ctx.on('loader/volatile-update', safeReconcile)   src/host/apply.ts:232
   → reconcile: adapter.sync() + registration.replace(routes) / directory.replace(entries)  apply.ts:197-221
     → commitRoutes → emitAdaptersUpdated          llm/src/index.ts:367-390, 468-482
       → Host 转发 llm/adapters-updated            api/remotes/src/remote-events.ts:44
         → client ctx.remote.$on → catalog.refresh()   ui-model-selection/src/client/service.ts:54, catalog.ts:96-99
           → session.modelCatalog() 重拉 → groups 更新
 与此同时 write() 末尾 this.describe()             settings/src/index.ts:422
   → 版本号+1 且 emit settings/document-updated     :317
     → ui-settings mirror.load()                   ui-settings/src/client/index.ts:41-46
       → ConfigFormController.derive()             config-form.ts:181-204
         → 我们的 snapshot 换新 → 组件重渲染
```

**能读到什么层的确认（票面问题 1）：** snapshot 的 `value` 是「Host 活配置 + schema 默认值」的投影（`projectForm(form, plainConfig(entry.fiber.config))`），`base` 是组合层（profile bundle / YAML），`user` 是用户层且**字段存在性**即「被覆盖」（`config-form-types.ts:16-31`）。所以 client 拿到的是**完整 profile 列表 + displayName + 未来新增的任何 schema 字段**，不是摘要。本仓 `snapshotOf` 已经这样读（`src/client/service/agents.utils.ts:68-79`）。

**为什么不会被重挂载：** `volatileOnly` 要求「只有 `config` 这一项变化，且除 volatile 路径外完全相等」（`entry.ts:146-150`）。我们的 `Config` 只有 `agents` 一个字段且整棵是 volatile（`src/host/config/schema.ts:46-48`）→ 恒成立 → 走 `_commitVolatile`，不 `_patchContext`，**registration 句柄与 adapter 实例都保持**，所以能用 `replace` 而不是重新注册。

### 5.2 直接改 YAML

- `hmr` 在 base bundle 里**默认开启**：`disabled: !!js "!ctx.get('profileContext')"`（有 profile 就开），`config.root: []` 只关模块热更，注释写明「Profile configuration reloads by default」（`packages/bundle/base/cordis.patch.yml:27-32`；rc.3 打包件 `dsh-base/cordis.patch.yml` 同一段）。
- 它 watch 了 profile patch 与 home patch 两个文件（`packages/boot/hmr/src/index.ts:385-407`）→ `reconcileProfile` → `recomposeProfile` → 回到 §5.1 的 `Entry.update`。
- 所以 **手改 `agents` 也是热的**（只要改动落在 volatile 子树内）；改 entry id / 增删 entry / 换 bundle 才是结构变更。`未实测`（没在应用内改 YAML 观察；headless / acp-app / sdk-app 三个 bundle 明确 `disabled: true`，桌面与 web 载体是开的）。

### 5.3 重启

无 hmr（headless 等）或结构变更时，Loader 重挂载插件 → 走 `registerAdapter` 的**首次注册**分支（`apply.ts:205-208`）→ 同样 `emitAdaptersUpdated`。客户端侧此时一般伴随整页重连：`connection/reset` → `catalog.resetGeneration()`（`ui-model-selection/src/client/service.ts:50-53`）+ `mirror.load()`（`ui-settings/src/client/index.ts:44`）。

### 5.4 选择器该订阅什么

| 订阅 | 谁提供 | 用来刷新 |
| --- | --- | --- |
| `configForm.subscribe(...)`（或 `useSyncExternalStore`） | `ctx.configForms` | 来源清单（`agents` 键、`displayName`、`enabled`） |
| `directory.store`（路径 4）或自己挂 `ctx.remote.$on('llm/adapters-updated' / 'settings/document-updated')` + `ctx.on('connection/reset')`（路径 3） | `modelDirectories` / `remote` | 组、模型、`routable`、失败行 |

**不要**只订阅 `llm/adapters-updated`：它只在**路由集合/元数据**变化时发；`enabled` 若做成「只影响我们自己的过滤逻辑」而不影响注册集合（例如字段存在但 tab 过滤在客户端做），就**不会**有 adapter 事件，只有 `settings/document-updated`。反过来，只订阅 settings 事件又会漏掉凭据变化导致的组刷新。

## 六、关闭某 ACP 之后的端到端表现

前置机制（前篇 §4.4 已证，此处补齐 client 侧）：`routes` 排除该路由、`directoryEntries` 保留（`src/host/apply.ts:103-111, 197-221`）。

| 环节 | 表现 | 证据 |
| --- | --- | --- |
| host 注册表 | 该 provider 从 `adapters` 删除，发 `llm/adapters-updated` | `llm/src/index.ts:468-482` |
| catalog | 组消失；`routableProviders` 不再含它；**不会**变成 `failures`（它压根没进 `listProviders()`） | `catalog.ts:24-25,64-71` |
| 客户端目录状态 | `groups` 无该组；`current` **仍保留**（来自 session 投影）；`routable: false` | `directory.ts:157-198` |
| 发消息 | `modelAvailable` 以 `listProviders()` + `listModels` 判定 → false；但目录可用性不阻止发送，请求时才报错（前篇 §4.4） | `catalog.ts:80-90` |
| 官方设置页 | 行仍在，`active: false` | `store.ts:45-70` |
| 我们的 tab | 该组不在 `groups` → tab 消失；若当前选择落在它上面，`routable === false` 但 `current` 仍指向它 | 由上两行组合 |
| 子进程（**易踩**） | `adapter.sync()` 只回收「profile 已不存在或 spawn 事实变化」的进程。若 `enabled:false` 只从 `routes` 过滤、`profiles()` 仍保留该 route，则**已 spawn 的 ACP 子进程不会被回收** | `src/host/service/acp-adapter.ts:368-379` |

最后一条是票 #01 的实现输入：要让「停用 = 回收进程」，停用必须在 `profiles()` 这一层也生效（或在 reconcile 里显式 dispose 该 route 的进程 + 失效绑定）。

## 七、排序依据

**事实（都不利于「配置键序」）：**

1. 组顺序 = adapter 注册序（`listProviders()` 的 Map 插入序，`llm/src/index.ts:483-486`），客户端再把 account/official 钉到最前（前篇 §1.3）。
2. 我们的 routes 顺序 = `[...profiles().keys()]` = `Object.entries(agents)` 的键序（`apply.ts:204`）＝ YAML 书写顺序 / 设置页写入顺序；**整数样键会被 JS 提到最前**。
3. `reconcile` 的去重依据 `routeFacts` 对 `[route, displayName]` **做了 `.sort()`**（`apply.ts:113-115`）→ **单纯在 YAML 里重排键序不会触发 `replace`**，注册表顺序不变（要等下一次真正的变化或重启）。想靠「手改 YAML 顺序」调 tab 顺序，第一版不要指望。
4. `commitRoutes` 是「全删再全插」（`llm/src/index.ts:468-482`）→ 每次 `replace` 我们这块路由都重新排到注册序末尾；跨插件相对顺序不可控，但**我们内部的相对顺序 = 传入数组顺序**，可控。
5. tab 的形态是「一个 ACP 一个 tab」，所以 **catalog 的组顺序对 tab 顺序毫无影响**；只有「tab 之间怎么排」需要依据。

**建议：**

- **v1：在 client 侧显式排序，不依赖任何顺序来源。** 稳定排序键：`(displayName 的 locale 比较, route)`；`DSH` 固定第 0 位。理由：与注册机制彻底解耦，改 YAML、改名、新增 ACP 都不会让用户熟悉的 tab 乱跳。
- 若产品要「用户自己定顺序」，那就把「配置键序」当语义：需要注意 (3)(4) 的坑，并且**必须在 host 侧显式排序**（在 `reconcile` 里对 `routes` 排序）才能保证 catalog / 官方设置页 / 我们的 tab 三处一致；代价是多改一处 host 代码。
- **不要**用「最近使用」当 v1 默认排序：`ModelDirectory` 只暴露当前会话的 `current`，没有跨会话的使用记录（`directory.ts:19-35`），要新造状态。

## 八、推荐方案与风险

### 8.1 推荐（零 host 新增面）

```ts
// 来源清单（客户端权威）
const snap = ctx.configForms.get(ENTRY).getSnapshot()        // ENTRY = PLUGIN_ID，见 register/agents-section.ts:11
const ours = snap.status === 'ready'
  ? new Set(Object.keys((snap.value as { agents?: object } | undefined)?.agents ?? {}))
  : new Set<string>()

// 目录（路径 4；或退化为 ctx.remote.session.modelCatalog()）
const state = ctx.modelDirectories.directoryFor(sessionId).store   // { groups, current, routable, failures }

const dsh  = state.groups.filter(g => !ours.has(g.id))
const acps = state.groups.filter(g => ours.has(g.id))          // 顺序按 §七 排序规则重排
// tab: [{id:'dsh'}, ...acps.map(g => ({id:g.id, label: displayNameOf(g.id) ?? g.name}))]
```

- 停用/0 模型的 ACP 不在 `groups` → 没有 tab（与「停用后从选择器消失」一致）。**已知空档：用户看不到「被停用了、可以重开」**，这个 affordance 归票 #01/#02 决定（设置页行仍在，`active:false`）。
- `snap.status !== 'ready'`（`loading`/`unavailable`）时**先按「全部是 DSH」渲染再升级**，或等首个快照再渲染；否则会看到 tab 先出现再分裂。`unavailable` 意味着 Host 没在 serve 我们的 namespace —— 此时设置页也不会出现，属同一个已知不变量（`src/client/register/agents-section.ts:7-11` 的注释即此）。
- `displayNameOf(route)` 从 `snap.value.agents[route].displayName` 取；一旦 `groups[].name` 与它不一致，**以 `groups[].name` 为显示、以 route 为身份**（Host 是事实源）。

### 8.2 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 两条通知不同源 | `settings/document-updated`（来源清单）与 `llm/adapters-updated`（组）来自两条独立路径，先后顺序不确定，会出现「tab 已加、组还没到」或反之的瞬时态 | 渲染时以 `groups` 为准（有组才出 tab），来源集合只用于**分类**不用于**枚举存在的 tab**；缺组时该 tab 临时不出现而不是空 |
| 路由名与别人冲突 | 用户把 ACP 起名 `deepseek-official` → 我们的 `registerAdapter` 抛 `DUPLICATE_ADAPTER`，`safeReconcile` 保留旧 routes（`apply.ts:222-229`），但**配置里已经有这个键** → 客户端会把别人的组误判成 ACP tab | 分类时要求「`group.id ∈ ours` **且** `group.name` 与本地的 `displayName ?? route` 一致」；不一致就归 DSH。并在设置页对冲突给出诊断（当前只进日志） |
| 依赖内部服务 | 路径 4 的 `ctx.modelDirectories` 是 `ui-model-selection` 的服务，不是文档化扩展点（无 README 契约页） | 用 `remote.session.modelCatalog()` + `selectModel` 作为等价退化实现；把两条路径收敛到一个薄适配层 |
| schema 校验失败导致的陈旧 | `ConfigFormController.decode` 若对 rehydrate 的 schema 校验失败，会**保留上一份 `value`**、`status` 仍是 `ready`（`config-form.ts:206-220`） | 不额外处理；但要知道「保存后 tab 没变」可能是这个原因，不是我们的 bug |
| YAML 键序不可靠 | 见 §七 (3)(4) | v1 客户端显式排序 |
| `/model` 仍是原生 | 自绘 tab 只覆盖 composer 座位；`/model` 弹窗走 `popupSelect`，不分组（前篇 §1.3、§4.7） | 归票 #02 §9 决定是否提示 |

## 九、对本图的含义

**给票 #02（交互规格）：**

1. **tab 顺序**：`DSH` 固定第一；ACP 段用稳定排序（`displayName` → `route`），不要承诺「跟配置顺序一致」——配置键序会被改名/新增扰动，而且纯键序变化甚至不会触发重注册（§七）。
2. **tab 标签**：`displayName ?? route`；真实配置里的 route 形如 `cc`/`oc`（本机 profile 实测），直接显示 slug 会很难读。tab 的身份/选中态用 route。
3. **哪些 tab 出现**：只渲染 `groups` 里真实存在的组（= 已启用且至少一个模型）。ACP adapter 的 `listModels()` 总保底一个合成的 default 模型（`src/host/service/acp-adapter.ts:407-432`），所以「启用着但 0 模型」几乎不会发生；失败 provider 只出现在 `failures[]`，要不要给它一个失败 tab 由本票定。
4. **非 ACP 第三方**（`llm-pi-ai` 等）归入 `DSH` tab；label 写 `DSH` 不写「原生」。若要单列，数据也够（按 `group.id` 一 tab 一组），但没有显示名分组可依据。
5. **瞬时不一致**：`settings/document-updated` 与 `llm/adapters-updated` 不同源，切换 tab 集合时有极短窗口。规格里应允许「tab 集合以 catalog 为准」，避免空 tab 抖动。
6. **已停用 ACP 的当前选择**：`current` 仍在、`routable === false`（§六），tab 已消失 → 必须定义显示（§01 §3）。

**给票 #01（启停语义）：**

1. **`enabled` 的位置决定了热更新的成本**：必须放在 `agents` 这个 volatile dict 内（`src/host/config/schema.ts:46-48`），这样保存即热更、client 通过已有 snapshot 立刻看到，**不需要任何新传输面**。放到 `agents` 之外（新的顶层字段）会让它变成非 volatile → `volatileOnly` 不成立 → 每次保存都整插件重挂载（`entry.ts:146-150`）。
2. **client 读取点要一起改**：`snapshotOf` → `profileOf` 目前会**丢掉未知字段**（`src/client/service/agents.utils.ts:45-65`，白名单式映射），新增 `enabled` 必须同时加进映射与 `EDITED_KEYS` 的携带逻辑（`:7`）。
3. **「停用只从选择器消失」在 client 侧成立**：组消失、`current` 保留、`routable:false`、设置页行保留且 `active:false`（§六）。
4. **进程回收要显式做**：只从 `routes` 过滤**不会**回收已 spawn 的子进程（`acp-adapter.ts:368-379` 的 `sync()` 以 `profiles()` 为判据）——这直接决定票面问题 4 的答案。
5. **已保存选择的降级**只有两个真实选项（沿用前篇 §4.4）：发送时阻止并提示重选 / 自动回退 DSH 默认；`modelAvailable` 已给出 false（`catalog.ts:80-90`），但不会自动阻止发送。

## 十、未实测 / 未确认

- **没在应用内做任何验证**：没保存过设置观察 tab 增减，没改过 YAML 观察 hmr 是否真触发，没停用过 ACP。「热更生效」全部是源码契约推断。
- **rc.2 → rc.3 差异**：本篇逐行复核过的 rc.3 文件（见文首清单：ConfigForm/mirror、settings describe/write、model-selection service/catalog、catalog 投影与 remote schema、base bundle 的 hmr 段）行为与 rc.2 源码一致；`ui-settings-subagent` 与 `llm-pi-ai` 只读了 rc.2 源码，未在 rc.3 逐行复核。
- **`hmr` 在桌面载体是否真的已加载并 watch**：只能从 base bundle 的 patch 与 `profileContext` 存在推出「应开」；本机 `~/Library/Logs/DeepSeek Harness` 只有 crash 日志，`~/.dsh/logs/*.log`（web 载体）里没有 hmr 的 `watching` 记录，故无运行时证据。
- **本仓 `src/client/types/runtime.ts:28` 的 `mode: 'host' | 'memory'` 字段在 rc.3 的 `ConfigFormSnapshot` 里不存在**（`config-form-types.ts:8-31`，rc.3 `client.js:1209-1231` 也不写它）。当前代码未使用该字段，不影响本票结论，但说明这份手写投影不是逐字段对齐的。
- **`ctx.modelDirectories` 能否在我们插件里直接注入**：契约上是普通 cordis 服务（`super(ctx,'modelDirectories')`），但没实测过跨插件注入的加载顺序（它 `inject: ['sessions','remote','remote.session']`，我们若依赖它需要同样声明）。
- **多连接/多客户端**：`llm/adapters-updated` 是 `mode: 'emit'` 无资源限定的转发事件（`remote-events.ts:44`），理论上所有已认证客户端都收到；没验证过权限矩阵下的实际投递。

## 主要一手来源

- rc.3 打包件（`app.asar` 内 `/dsh/node_modules/@deepseek-ai/`）：
  - `dsh-client-ui-settings/lib/client.js`（`ConfigFormController.derive` `:1209-1231`、`ConfigForms.get` `:1294-1300`、`whileServed` `:1315-1337`、mirror 失效订阅 `:1489-1493`）
  - `dsh-settings/lib/index.js`（`describe` `:413-455`、`document-updated` emit `:435`、`write` 末尾的 `describe()` 调用）
  - `dsh-api-session-controller/lib/typert.remote-client.js`（`ModelCatalog` zod schema `:706-731`、`session/modelCatalog` descriptor `:1668-1677`）
  - `dsh-llm/lib/typert.remote-client.js`（`llm/listConfigurableProviders`、`llm/listProviders` descriptor 与字段说明）、`dsh-llm/lib/index.js:1874`（`info.id !== provider` 抛错）
  - `dsh-base/cordis.patch.yml`（`hmr` 条目 `disabled: !!js "!ctx.get('profileContext')"`、`root: []`）
- rc.2 可读源码（commit `687f282e`）：
  - `packages/client/ui-settings/src/client/{config-form.ts, config-form-types.ts, settings-mirror.ts, index.ts}`
  - `packages/settings/settings/src/{index.ts, schema.ts}`
  - `vendor/loader/src/config/entry.ts`、`vendor/cosmokit/src/volatile.ts`
  - `packages/boot/config-editor/src/index.ts`、`packages/boot/hmr/src/index.ts`
  - `packages/llm/llm/src/index.ts`、`packages/llm/llm-{deepseek-account,deepseek-api-key,pi-ai}/src/index.ts`
  - `packages/api/session-controller/src/{catalog.ts, index.ts}`、`packages/api/remotes/src/remote-events.ts`
  - `packages/client/ui-model-selection/src/client/{service.ts, catalog.ts, directory.ts}`
  - `packages/client/ui-slots/src/index.ts`、`packages/client/ui-settings-models/src/client/store.ts`
  - `packages/client/ui-settings-subagent/src/client/{index.ts, subagent-model-selection-card-controller.ts}`
  - `packages/bundle/base/cordis.patch.yml`
- 本仓库（工作区）：
  - `src/client/{index.ts, types/runtime.ts}`、`src/client/service/{agents.ts, agents.utils.ts}`、`src/client/components/agents-section.tsx`、`src/client/register/agents-section.ts`
  - `src/host/apply.ts`、`src/host/config/schema.ts`、`src/host/service/acp-adapter.ts`
  - `docs/dsh-plugin-dev/03-runtime-faces.md`、`docs/design/dsh-model-picker-research-2026-10-27.md`
- 本机运行配置（观察，非契约）：`~/.dsh/profiles/desktop/{cordis.patch.yml, package.json}` —— `agents` 实际键为 `cc/codex/oc/flick/agy`，`displayName` 为 `Claude Code/Codex/OpenCode/MyFlicker/Antigravity`。
