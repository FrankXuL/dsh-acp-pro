# 影子替换 `conversation.input.model`：契约、行为面与实现骨架（2026-10-27）

**检索对象：** 本机 DSH **0.2.1-rc.3**（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）；可读源码来自本机 monorepo checkout `/Users/xulilili/Downloads/闲聊/deepseek-harness`（**0.2.1-rc.2**，commit `687f282e`）。本仓库 `/Users/xulilili/Downloads/dev/code/dsh-acp-pro`（0.1.0）。

**与前一篇的关系：** [`dsh-model-picker-research-2026-10-27.md`](dsh-model-picker-research-2026-10-27.md) 已经证明「选择器内部没有来源 tab 插槽」「`/model` 不读 label slot」「低 `priority` 可以影子 `single` 座位」。本文**不重复推导**这三条，只回答用户拍板「影子 + 自绘带来源 tab 的选择器」之后的问题：影子怎么注册、数据从哪来、动作发给谁、原生行为要复刻哪些、坏了怎么退。

**证据层级（沿用前一篇）：**

| 层级 | 含义 | 本文标记 |
| --- | --- | --- |
| A | 源码/契约：rc.2 可读源码行号，或 rc.3 打包件内文件行号 | `源码契约` |
| B | 本仓库 plugin dev 文档 / 既有笔记 / README | `plugin 文档` |
| C | 未在运行中的应用内验证 | `未实测` |

**路径缩写：**

- `rc2:` = `/Users/xulilili/Downloads/闲聊/deepseek-harness/`
- `rc3:@deepseek-ai/x/lib/y.js:N` = `app.asar` 内 `dsh/node_modules/@deepseek-ai/x/lib/y.js` 第 N 行（rc.3 打包件按行读取，未 minify 的包可直接给行号）
- `rc3fe:` = `app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BXV-oxvX.js`（**压缩**，只给字符串定位，不给行号）
- 无前缀 = 本仓库

> 所有「能/不能」都是源码与契约判断，**不等于应用内验收**。真机行为一律 `未实测`。

## 结论摘要

1. **座位不是 `ui-model-selection` 的私有财产**：`conversation.input.model` 的 spec 由 `ui-conversation` 的 composer bar 注册声明（`rc2:packages/client/ui-conversation/src/client/apply.ts:458`；rc.3 `rc3:@deepseek-ai/dsh-client-ui-conversation/lib/client.js:20105-20108`），渲染点在 `InputBar`（`rc2:…/skeleton/InputBar.tsx:476`；rc.3 `:19263`）。原生选择器只是该座位的一个普通注册者，所以**影子替换的是「一个注册者」，不是「一个插件」**——`ui-model-selection` 卸掉后座位依然存在且可被我们独占。`源码契约`
2. **影子唯一安全的写法是 `ctx.slots.inject` + `priority: -1` + 不声明任何子插槽**：`inject` 让「座位未声明」变成**静默不生效**而不是装载失败（`rc2:packages/client/ui-renderer/src/client/registry.ts:194-271`；rc.3 同实现 `rc3:@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1368-1423`）；`-1` 让「同 priority 抛错」这条规则永远不触发（`rc2:packages/client/ui-slots/src/index.ts:1216-1223`，rc.3 同串 `rc3fe` 偏移 ~487512）。`源码契约`
3. **影子会让 `conversation.input.model.label` 失效**：该子插槽由原生注册者声明（`rc2:…/ui-model-selection/src/client/index.ts:172-181`；rc.3 `:1903-1918`），我们既不能重复声明（会抛，`rc2:…/ui-slots/src/index.ts:1245-1251`），也不能渲染未声明的子插槽（`renderSlot` 只授权给声明者，`rc2:…/ui-renderer/src/client/scoped-slots.tsx:78`）。结论：**影子期间所有第三方 label 徽标静默消失**，原生三处渲染点（`rc3:…/ui-model-selection/lib/client.js:1464-1470, 1517, 1550, 1669`）换成了空白。`源码契约`
4. **数据面不需要新造**：`ui-model-selection` 把每会话的唯一 `ModelDirectory` 暴露成 cordis 服务 `modelDirectories`，`directoryFor(sessionId)` 返回**同一实例**给 composer 座位和 `/model` 弹窗（`rc2:…/ui-model-selection/src/client/service.ts:66-96`；rc.3 `:1016-1042`）。影子注入这个服务就自动获得 `current/groups/failures/pending` 与刷新链路；**自建一套 `modelCatalog()` 会制造第二个 pending/current 源**。`源码契约`
5. **「当前模型」的唯一权威是会话投影 `modelSelection`**：`next = pending ?? lastUsed`，由 `model/selection` 事件与 `request/header` 折叠（`rc2:packages/api/session-controller/src/model-selection-projection.ts:47-60`）。座位可直接用标准钩子 `useProjection('modelSelection')` 读（`rc2:packages/client/ui-session/src/client/index.ts:167-175` + `rc2:packages/api/session-controller/src/client/sessions/projection-store.ts:38-45`），不必依赖内部服务。`源码契约`
6. **选模型只有一个动作**：`session/selectModel({sessionId, provider, model, reasoningEffort?})` → Host `resolveCallConfig` 校验 effort → `agent.session.append('model/selection')`（`rc2:…/session-controller/src/commands.ts:157-192`、`:agent.ts:339-342`）。**没有乐观回滚**：`current` 从不提前改，失败就是 `status:'error'` + toast，菜单不关（`rc2:…/ui-model-selection/src/client/directory.ts:91-126` + `ModelSelect.tsx:376-406`）。`源码契约`
7. **Agent 主动 `config_option_update` 不会回流到选择器**：ACP 适配器只改自己的 `session.models/efforts` 并持久化 binding，既不写 DSH 的 `modelSelection`，也不发 `llm/adapters-updated`（`src/host/service/acp-adapter.ts:712-722`）。选择器和 `/model` 都不刷新；只有本仓库自己的 ACP 面板（1s 轮询）会显示新值（`src/client/components/session-control-panel.tsx:139-150, 251-256`）。`源码契约`
8. **降级有一条免费通道**：影子组件渲染崩溃会被 slot 引擎判为「abdicate」一次性退役，座位自动回落到下一个注册者（= 原生选择器）（`rc2:…/ui-renderer/src/client/scoped-slots.tsx:1127-1134`、`rc2:…/ui-slots/src/index.ts:1545-1553`；rc.3 同）。但**装载期的注册失败不会自动回退**，必须自己 try/catch。`源码契约`
9. **同一会话会出现两个「当前模型」显示源，但都不是影子新增的**：(a) composer 座位 / `/model` 弹窗共用同一个 `ModelDirectory`，天然一致；(b) 本仓库 ACP 面板显示的是 **ACP 侧** config option 的 `currentValue`，比 DSH 投影滞后一个请求。影子只要复用 `ModelDirectory` 就不会引入第三个源。`源码契约` + `未实测`
10. **需要 Lead 找用户拍板**：影子期间要不要（a）放弃第三方 label 徽标、(b) 把「未归属任何 ACP 路由的 provider」放进 DSH tab 还是独立「其他」tab、(c) 影子作为默认形态还是设置项开关（崩溃时是否值得保留自愈）。`未实测`

## 一、影子注册：规则与失败模式

### 1.1 座位的声明者、注册者与渲染点

| 角色 | 证据 |
| --- | --- |
| 声明 spec（`single` / `session`） | `rc2:packages/client/ui-conversation/src/client/apply.ts:458`；rc.3 `rc3:@deepseek-ai/dsh-client-ui-conversation/lib/client.js:20105-20108` |
| owner props 类型 | `rc2:…/ui-conversation/src/client/contract/slots.ts:292-298`、`:486-489`（`InputControlOwnerProps { locked: boolean }`） |
| 渲染点 | `rc2:…/ui-conversation/src/client/skeleton/InputBar.tsx:476`；rc.3 `:19263` |
| 原生注册者（唯一） | `rc2:packages/client/ui-model-selection/src/client/index.ts:168-194`；rc.3 `:1903-1918` |

注册者在**同一个 `register` 调用里**声明子插槽 `conversation.input.model.label`；声明随注册者的 disposer 一起塌陷（`rc2:…/ui-slots/src/index.ts:1146-1148`）。这意味着「影子赢」时原生注册**仍然活着**（只是不渲染），label 子插槽的声明也仍然活着。

### 1.2 priority 规则（引擎层，非文档化插件扩展点）

- 影子能力写在 `SlotCore.register` 的契约注释里：同 cell 的 entry 按 `priority` 升序排列，**最低者渲染**；同 priority 再注册抛错并提示「register at a different priority to shadow it (lowest renders)」。`rc2:…/ui-slots/src/index.ts:1138-1144`
- 落地：`single` 只在**完全相同 priority** 时冲突（`:1220-1223`）；entry 数组按 priority 稳定排序（`:1286-1288`）；`entriesOfSlot` 取每个 cell 的**第一个未被 abdicate 的** entry（`:1356-1372`）。
- rc.3 复核：压缩前端包里存在同一条错误串与 `entriesOfSlot` 实现（`rc3fe` 偏移 ~487326 / ~487512 / ~490202），排序比较器与 rc.2 一致（`priority` 升序，list 再按 `order`）。
- 结论：`priority: -1` 在任何加载顺序下都稳定赢过原生的 `0`。`源码契约`

### 1.3 `slots.inject` 的延迟注册语义（决定「装载失败」长什么样）

`SlotRegistry.inject(key, callback)`（`rc2:…/ui-renderer/src/client/registry.ts:194-271`）：

1. 座位**已声明** → 回调同步执行；回调里抛错**同步抛给调用方**（即 `apply` 抛出）。
2. 座位**未声明** → 回调先不执行，挂在 declaration 订阅上；**永不声明 = 永不执行 = 静默无副作用**。
3. 之后某个注册者声明了它（`declarationEpoch` 变化）→ 回调在新 effect 里执行；旧贡献先塌陷。
4. 迟到执行时的回调异常**不会**抛给任何调用方：`queueMicrotask(() => { throw failure })` → 未捕获异步错误（`:247-259`），并且该 inject 永久退役（`:219-227`）。

### 1.4 失败模式矩阵

| 场景 | 表现 | 证据 |
| --- | --- | --- |
| 我们与原生**同 priority** 注册 | 后注册方抛 `single slot "conversation.input.model" already has a registration at priority 0 …` | `源码契约` `rc2:…/ui-slots/src/index.ts:1220-1223` |
| 我们在原生之前用同 priority 注册 | 反过来**原生抛错**：若是同步阶段 → `ui-model-selection` 的 `apply` 抛出（它的 `/model` 命令、目录服务一起没）；若是迟到声明 → 未捕获微任务错误（`rc2:…/ui-renderer/.../registry.ts:247-259`）。**这是最坏的失败模式：为了加 tab 反而拆掉 `/model`** | `源码契约` |
| 座位未声明 + 我们用 `register` | 同步抛 `slot "conversation.input.model" is not declared (a parent entry's children table must declare it)`，异常冒出 `apply` | `源码契约` `rc2:…/ui-slots/src/index.ts:1210` |
| 座位未声明 + 我们用 `inject` | 什么都不发生（插件正常加载、座位仍是原生/空） | `源码契约` `rc2:…/ui-renderer/.../registry.ts:229-245` |
| 0.1 核心（无 `slots` 服务） | 客户端插件声明了 `inject: ['slots', …]`（`src/client/index.ts:13`），cordis 不会 apply → 整个 client 半边静默休眠；宿主半边不受影响（`README.md:137` 明说 0.1 核心仍可加载宿主半边） | `plugin 文档`；client 半边为 cordis 语义推导，`未实测` |
| 0.1 核心有 `slots` 但无该 key | 同「未声明」：`inject` 等待，永不执行 | `源码契约`（未在 0.1 上实测，`未实测`） |
| 我们声明 `conversation.input.model.label` | 原生已声明时同步抛 `slot "…" is already declared (by an entry in "conversation.input.model")`；若我们抢先生效，则**原生注册抛错**，`/model` 连带失效 | `源码契约` `rc2:…/ui-slots/src/index.ts:1245-1251` |
| 引擎升级把原生 priority 也改成 `-1` | 我们（或它）同 priority 冲突 → 直接抛；需要 try/catch 兜底 | `未实测`（上游未发生） |

**注册骨架（结论形态，不含实现）：**

```ts
ctx.inject(['slots', 'modelDirectories'], (scope) => {
  const undo = scope.slots.inject('conversation.input.model', () => {
    try {
      return scope.slots.register({
        name: 'conversation.input.model',
        priority: -1,          // 比原生低；不声明 children，不抢 label
        locale: NS,
        inject: (sessionId) => ({ models: scope.modelDirectories.directoryFor(sessionId) }),
      }, ShadowModelSeat)
    } catch (error) {
      ctx.logger?.warn(`${PLUGIN_ID}: model picker shadow unavailable, native seat kept`, error)
      return () => {}
    }
  })
  return undo
})
```

`src/client/index.ts:31-35` 已有同款 `ctx.slots.inject(...)` 用法；`src/client/types/runtime.ts:69-72` 已把 `slots.inject/register` 收窄成插件侧类型。`plugin 文档`

## 二、座位 owner props / scope / 锁定语义

- **owner props 只有 `locked`**，文档注释是「Whether the composer currently refuses interaction」（`rc2:…/ui-conversation/src/client/contract/slots.ts:486-489`）。
- `locked` 的实际取值**不等于** composer 的 `locked`：`const modelSeatLocked = removed || inert || !live`，而 `locked = disabled = removed || inert || !live || blocked !== undefined || parentOffline`（`rc2:…/skeleton/InputBar.tsx:132-146`；rc.3 `:19002-19006`）。注释写明设计意图：**权限 block 是「选个模型就能解除」的唯一控件，所以 block 时不锁模型座位**（`:141-145`）。影子必须原样消费这个 prop：`disabled={locked}` 只作用于 trigger，不作用于行。
- **scope 是严格 `session`**（声明处 `kind:'single', scope:'session'`）。渲染器对严格 session 座位的约束：拿不到 scope binding 就抛 `SlotAssemblyError`（`rc2:…/ui-renderer/src/client/scoped-slots.tsx:1116`、`StrictSessionEntry` `:1029-1058` 同义）——所以**影子组件永远在「有会话」时被调用**，不需要处理 sessionless 分支。
- **会话未就绪**：`InputBar` 只在 `sessionId !== undefined && input !== undefined` 时渲染座位（`rc2:…/InputBar.tsx:476`；rc.3 `:19263`），草稿态/无 workspace 态根本不会渲染。若会话在渲染中途被移除导致 binding 消失，属于严格 session 的装配错误（`未实测`，只在切换瞬间可能）。
- **被寻址的 subagent 会话**：原生靠 `sessions.subagentAddress(sessionId) === undefined` 算 `available`，为 false 时 `ModelSelect` 直接 `return null`（`rc2:…/ui-model-selection/src/client/index.ts:178-193`、`ModelSelect.tsx` 的 `if (!available) return null`）。影子可用**文档化的标准 prop** 拿到等价信息：`useSession(s => s.subagent)`，`SessionSnapshot.subagent` 为 `{ address, parentAvailable? } | null`（`rc2:packages/api/session-controller/src/client/contract/snapshot.ts:69-88`；`useSession` 在 `rc2:packages/client/ui-session/src/client/index.ts:167-171`）。
- **组件实际收到的 props**（session 作用域标准套件 + conversation 合并 + 注册者 inject + locale）：
  - 框架套件：`sessionId`、`useSession`、`useProjection`、`useAccess(action)`（`rc2:…/ui-session/src/client/index.ts:167-175`，装配 `rc2:…/ui-renderer/src/client/scoped-slots.tsx:544-556`）
  - conversation 合并：`useConversation`、`useInput`、`inputActions`（`rc2:…/ui-conversation/src/client/contract/slots.ts:330-336`）——本仓库面板已在用 `sessionId/input/inputActions`（`src/client/components/session-control-panel.tsx:7-13`）
  - 自己 `inject:` 的业务面 + `locale: NS` 带来的 `t`
- **切换会话会 remount**：严格 session 座位按 `sessionGenerationKeyOf(binding)` 作 key（`rc2:…/scoped-slots.tsx:1044-1047`），组件内 `open/query/pane/tab` 状态天然清空——原生依赖这一点（`ModelSelect` 没有跨会话持久 UI 状态）。

## 三、数据来源：目录 DTO、当前选择、effort

### 3.1 `session.modelCatalog()` 的完整 DTO

`ModelCatalog`（`rc2:packages/api/session-controller/src/types.ts:158-165`；rc.3 wire schema `rc3:@deepseek-ai/dsh-api-session-controller/lib/typert.remote-client.js:706-736`，`sourceLocation` 指 `packages/api/session-controller/src/index.ts:338`）：

```ts
{
  default: { provider, model, reasoningEffort? }            // 部署默认（unconfigured session 用）
  routableProviders: readonly string[]                      // 至少一个可用模型的 route
  groups: readonly { id, name, models: { id, name, description?, reasoning?: {
      efforts: { id, name, description? }[]
      defaultEffort?: string
  } }[] }[]
  failures: readonly { id, name, message }[]                 // 逐 provider 隔离的加载失败
}
```

Host 侧 `buildModelCatalog`：遍历 `llm.listProviders()`（注册序）、逐 provider `listModels()`、逐模型 `resolveModelInfo()`，**空组被丢弃**，失败进 `failures`（`rc2:packages/api/session-controller/src/catalog.ts:10-59`；rc.3 `rc3:@deepseek-ai/dsh-api-session-controller/lib/types/catalog.js:10-59`）。`源码契约`

两条容易踩的语义：

- `routableProviders` 与客户端 `state.routable` **都没有消费者**（原生只写不读，`rc3:@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:958-972`；grep 无读取点）。不要用它判断「当前模型可选」。`源码契约`
- 目录很贵：ACP 的 `resolveModel` 在 `discoverModels` 打开时会为**每个模型**开一个真实 ACP 会话探 effort（`src/host/service/acp-adapter.ts:451-505`、`src/host/service/acp-agent.ts:512-537`，含 `newSession` + `selectModel` + `closeSession`）。影子**不要**在每次打开菜单时重拉目录（原生靠 catalog 缓存，`rc2:…/ui-model-selection/src/client/catalog.ts:56-70`），否则会放大探测成本。`源码契约` + `plugin 文档`（`docs/dsh-plugin-dev/09-compatibility.md` 同结论）

### 3.2 当前选中的 provider/model

三层，优先级从高到低：

1. 会话投影 `modelSelection.next`（= `pending ?? lastUsed`），由 `model/selection` 与 `request/header` 事件折叠，**只前进不后退**（`rc2:packages/api/session-controller/src/model-selection-projection.ts:47-60`）。
2. `modelSelection.lastUsed`（已消费的最近一次请求）。
3. `catalog.default`（部署默认）。

原生目录的实现：`const intended = projected?.next ?? catalog.value?.default`，然后 `const selection = projected.next ?? catalog.value.default`（`rc2:…/ui-model-selection/src/client/directory.ts:157-186`）。`源码契约`

影子读法二选一：

- **推荐**：直接 `useProjection('modelSelection')`（标准 hook，`rc2:…/api/session-controller/src/client/sessions/projection-store.ts:38-45`），拿 `next/lastUsed` 自己算；或
- 复用 `modelDirectories.directoryFor(sessionId).store`（原生已把三层兜底算好，含 `retainedEffort`）。

两者不会打架（同一投影源），但只有第二种能和 `/model` 的 `pending` 完全同帧。

### 3.3 effort 的当前值与可选项

- **可选项**：当前模型目录项的 `model.reasoning.efforts`；`defaultEffort` 是「provider 默认」。没有 `reasoning` 字段的模型 → **不渲染 Effort 行**（不是禁用）。原生：`effortChoices` 由 `reasoning` 生成，root 的 Effort cell 条件渲染（`rc2:…/ModelSelect.tsx:130-150`、`:517`；rc.3 `:1205-1216`、`:1555-1560`）。`源码契约`
- **当前值**：`next.reasoningEffort ?? model.reasoning.defaultEffort`；显示名从 `efforts` 里按 id 查，找不到就显示原始 id。原生 `effectiveEffort` / `effortLabel`（`rc2:…/ModelSelect.tsx:120-135`）。`源码契约`
- **兜底**：当前模型在目录里但 `reasoning` 缺失时，原生用 `state.retainedEffort`（上次在本 generation 里见过的等级名）显示（`rc2:…/directory.ts:161-165`、`:172`；由 `rc2:…/ModelSelect.tsx:130` 消费）。影子若自算 effort，会丢掉这个兜底（低影响，记录在案）。`源码契约`
- ACP 的 `defaultEffort` 来自 agent 的 `thought_level` option 的 `initial`（`src/host/service/acp-adapter.ts:505-524`、`acp-agent.ts:118-135`），不是「用户上次选的」；因此 ACP 模型的默认等级在一次会话内稳定，也不会随 `config_option_update` 变。`源码契约`

## 四、动作：选模型 / 选 effort / 失败与 pending

### 4.1 RPC 契约

```ts
// 客户端：ctx.remote.session.selectModel(request)
{ sessionId, provider, model, reasoningEffort? }        // strictObject，多字段会被拒
→ { selected: { provider, model, reasoningEffort? } }  // 规范化后的选择
```

`rc3:@deepseek-ai/dsh-api-session-controller/lib/typert.remote-client.js:1170-1185`（参数/结果）、`:1880-1908`（rpc 声明，`sourceLocation: packages/api/session-controller/src/index.ts:311`）；rc.2 定义 `packages/api/session-controller/src/index.ts:310-312`。`源码契约`

Host 端链路（`rc2:packages/api/session-controller/src/commands.ts:157-192`）：

1. `resolveAgent(sessionId)` —— 会话必须先被 resume（`session/writer-held` 在有其他写者时抛）。
2. `requireModel(request)` + `llm.resolveCallConfig({provider, model, reasoningEffort})` —— 校验模型存在、effort 被该模型支持（不支持抛 `UNSUPPORTED_REASONING_EFFORT`，`rc2:packages/llm/llm/src/index.ts:915-923`），再被包成 `session/model-unavailable`。
3. `agents.selectForNextRequest(agent, selected)` → `agent.session.append('model/selection', selection)`（`rc2:…/session-controller/src/agent.ts:339-342`）→ 投影重算 → 帧推给客户端。
4. 后台 `agentDefaultModel.saveSelection(selected)`（失败只 warn，`commands.ts:177-181`）——即「顺便记住成默认」。

**对 ACP 路由而言，这只是记账**：真正下发 `session/set_config_option` 是在下一次请求的 `ensureSession` 路径里（`src/host/service/acp-adapter.ts:744-770`）。所以「选了模型但 Agent 拒绝」会表现为**下一次请求失败**，而不是选择失败。`源码契约`

### 4.2 pending 与「回滚」

原生的状态机（`rc2:…/ui-model-selection/src/client/directory.ts:91-131`）：

- 提交时：`status='selecting'`, `pending=selection`, `error=null`；**`current` 不动**。
- 成功后：`status='ready'`, `pending=null`，再 `syncInputs()` 从投影/目录重算 `current`。响应里的 `selected` **被忽略**（只用 `result.ok`）。
- 失败后：`status='error'`, `pending=null`, `error="code: message"`；`current` 仍然是旧值——**因为没有乐观更新，所以没有回滚动作**。
- 连接重置：`resetConnected()` 把 `selecting` 降级为 `idle`、清 `pending`/`error`，并 bump generation 让晚到的响应失效（`:133-141`）。

UI 侧的 pending 表达（`rc2:…/ModelSelect.tsx:150`、`:392-420`、`:612`；rc.3 `:1216`、`:1715`）：

- `busy = pending !== null`
- trigger：`aria-busy`，用 `StateDot(ongoing)` 顶替 chevron
- 所有行 `disabled={busy}`，搜索框 `readOnly={busy}`
- 「正在生效的那一行」用 `StateDot(ongoing)` 顶替勾选（模型行比 `pending.provider/model`，effort 行还比 `pending.reasoningEffort`）
- 成功后焦点回 trigger 且**不带 focus ring**（`selectionFocus` 状态）

### 4.3 失败如何通知用户

- 选择失败 → 共享 `Toast`（锚在 composer card 上），文案 `error.action = 模型操作失败：{code}: {message}`；`session/writer-held` 换成专门的「本会话已被其他 DSH 实例占用」（`rc2:…/ModelSelect.tsx:376-390`、locale `error.sessionInUse`）。
- **菜单不关**（`closeAfterSelection` 只在 `result.ok` 时调用）。
- 目录加载失败 → 菜单内 error strip + 「重新加载」（`lastActionRef.current === 'load'` 才算，`:570-578`；rc.3 `:1602-1610`）。
- 单 provider 失败 → 每个 failure 一条 warning strip（不是不可选行！`/model` 里才是不带 `active` 的失败行）：`rc2:…/ModelSelect.tsx:566-583`，对照 `/model` 的 `optionsOf` 失败行 `rc2:…/ui-model-selection/src/client/index.ts:52-72`。

### 4.4 Agent 主动改配置

`config_option_update` 落点：`applyConfigOptions(session, update.configOptions)` → 改 `session.models`/`session.efforts` → `binding.revision++`、`settingsRevision++` → 持久化 binding（`src/host/service/acp-adapter.ts:712-722`）。**不发 `llm/adapters-updated`**（全仓仅 `src/host/apply.ts:207-218` 的 reconcile 会发），也**不写 `model/selection`**。因此：

- 选择器（原生或影子）**不会**因为 Agent 改配置而刷新「当前模型」或模型列表；
- `/model` 弹窗同理（它读同一个 `ModelDirectory`）；
- 只有本仓库 ACP 面板的 `模型/思考强度` 只读行会在 ≤1s 内显示新值（轮询，`src/client/components/session-control-panel.tsx:139-150`、`:251-256`）；
- 这也解释了为什么面板**禁止**编辑 `model`/`thought_level`：`setSessionConfig` 显式拒绝（`src/host/service/acp-adapter.ts:293-298`），避免出现第二个可写入口。`源码契约`

## 五、原生座位行为清单（自绘必须逐项决定复刻/放弃）

来源：`ModelSelect` 的契约 docstring（`rc2:…/ui-model-selection/src/client/ModelSelect.tsx:1-23`）、rc.3 同段（`rc3:@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:1114-1136`）、包 README（`rc3:…/ui-model-selection/README.md:44-80`）、CSS 令牌（`rc3:…/lib/client.js:1060`）。

| # | 行为 | 契约细节 | 影子处理 |
| --- | --- | --- | --- |
| 1 | 两级菜单 | root = `Model` / `Effort` 两行（`cell`），各下钻一个 pane | 可改造：root 换成「左边来源 tab + 右侧模型列表」，Effort 仍需一层 |
| 2 | 搜索阈值 | **模型总数 > 4** 才显示搜索框（`rc2:…/ModelSelect.tsx:114`；`/model` 恒有） | 复刻；tab 切换后阈值按「当前 tab 内模型数」还是「全目录数」需 #02 定（原生是全局） |
| 3 | 搜索匹配/排序 | `rankByName`：大小写不敏感**有序子序列**，每组内按 `前缀 > 对齐分 > 目录序`（`rc2:packages/client/ui-primitives/src/rank-by-name.ts:70-93`，公共导出 `src/index.ts:82`），命中后**隐藏空组** | 直接复用 `rankByName` 可 1:1；否则要重写排序 |
| 4 | 组标题 | `MenuGroup` 吸顶标题，文本 = `group.provider.name`，`deepseek-account` 换成本地化「DeepSeek 账号」（`rc2:…/ModelSelect.tsx:96-110`；rc.3 `:1171-1177, 1636-1637`）；吸顶背景靠 `observeStickyMenuGroups` | tab 化后组标题可省，但「同名 provider 内排序不变」要保留 |
| 5 | 组顺序 | `orderModelProviders`：`deepseek-account` → `deepseek-official` → 其余保持目录序（`rc2:…/provider-order.ts:9-15`；rc.3 `:1108-1110`） | tab 内应沿用（否则同一 tab 内顺序和 `/model` 不一致） |
| 6 | 勾选 | `role="menuitemradio" aria-checked`，勾在行尾 `<span class=check>`（`rc2:…/ModelSelect.tsx:588-620`） | 复刻 |
| 7 | pending | 见 4.2；trigger 顶替 chevron、行内顶替勾 | 复刻，否则用户不知道点没点上 |
| 8 | 禁用 | 只有 `busy` 时禁行、`locked` 时禁 trigger（`rc2:…/ModelSelect.tsx:475, 605`） | 复刻（尤其 `locked` 语义见第二节） |
| 9 | 失败行 | 座位里是 warning strip + 重试（不可选；`rc2:…/ModelSelect.tsx:566-583`，加载失败条 `:570-578`）；`/model` 里才是 `detail=option.loadError` 的不可选行（`rc2:…/ui-model-selection/src/client/index.ts:52-72`） | 复刻 strip 形态 |
| 10 | Effort 行 | 仅当当前模型有 `reasoning` 时出现；选项 = `provider default`（仅当无 `defaultEffort`）+ 各等级（`rc2:…/ModelSelect.tsx:130-150`） | 复刻；tab 切换后按该 tab 当前模型重算 |
| 11 | model label 插槽 | trigger / root 当前值 / 每个 option 三处 `renderSlot(..., {fallback: model.name})`，外层带 `data-provider-id`/`data-model-id`（`rc2:…/ModelSelect.tsx:435-450`；rc.3 `:1464-1470`，三处调用 `:1517 / :1550 / :1669`） | **放弃**（影子不能声明/渲染 label）；如需徽标只能自绘进自己的行 |
| 12 | 键盘/焦点 | ↑/↓ 在 root/effort 移焦点；有搜索时 ↑/↓ 只移高亮+焦点留搜索框；Enter/Tab 接受高亮；Escape/Shift+Tab 先退 pane 再关；Tab 从 trigger 进搜索或当前行；行内 `onMouseMove` 同步 hover/focus；选择后焦点回 trigger 且无 ring（`rc2:…/ModelSelect.tsx:303-395`） | 必须复刻（这是最大工作量）；`#04` 原型要先验键盘 |
| 13 | 门户与定位 | `createPortal(document.body)` + `position:fixed`，按 trigger rect 右对齐、上翻，夹在视口 12px 内；监听 scroll(capture)/resize/ResizeObserver 重算（`rc2:…/ModelSelect.tsx:217-245`） | 复刻或用 `MenuSurface` 自带能力（`未实测` 其对自定义内容的支持度） |
| 14 | 无障碍文案 | trigger `aria-label` 三态（loading / select / `选择模型，当前 {model}[，推理等级 {effort}]`）、`aria-haspopup=menu`、`aria-expanded`、`aria-controls`、`aria-busy`；menu `aria-label`；搜索 `role=searchbox` + `aria-activedescendant`；空/无匹配 `role=status`（trigger `rc2:…/ModelSelect.tsx:465-476`、menu `:500-506`、搜索 `:533-536`、空态 `:624`；locale 全表 `rc3:…/lib/client.js:1744-1767`） | 复刻；新增 tab 需要 `role="tablist"/tab/tabpanel"` + 方向键约定（上游没有先例，`#02` 定义） |
| 15 | 紧凑模式 | composer 行宽不够时给行加 `data-model-compact`，把 `--dsh-composer-model-text-display` 设为 `none`、`--dsh-composer-model-icon-display` 设为 `block`；座位必须消费这两个变量才不撑破布局（`rc2:…/skeleton/control-row-layout.ts:10-40`、`InputBar.module.css:275-276`、`ui-model-selection` CSS 的 `.triggerIcon/.triggerLabel`） | 必须复刻（否则窄宽度下 tab 版会把 composer 挤坏） |
| 16 | 空态/加载 | 目录 ready 且过滤后为空 → `role=status` 的「暂无可用模型」/「没有匹配的模型」（`rc2:…/ModelSelect.tsx:622-626`）；加载中显示「正在刷新模型列表…」（`:566-568`） | 复刻 |

## 六、刷新订阅链路

原生只有**一个**全局 catalog + 每会话一个 directory（`rc2:…/ui-model-selection/src/client/service.ts:43-96`）：

| 触发 | 动作 | 证据 |
| --- | --- | --- |
| `llm/adapters-updated` | `catalog.refresh()`（invalidate + 重拉） | `service.ts:54` |
| `settings/document-updated` | 同上 | `service.ts:55` |
| `credentials/record-updated` | 同上 | `service.ts:56` |
| `credentials/reference-updated` | 同上 | `service.ts:57` |
| `connection/reset` | `resetGeneration()`（清 reasoning 缓存、丢值、重拉）+ 每个 directory `resetConnected()`（丢弃在途选择） | `service.ts:50-53` |
| catalog store 变化 | 每个 directory `syncInputs()` 重算 current/groups/pending | `directory.ts:68` |
| 会话投影变化 | 同上 | `directory.ts:69` |
| 打开菜单 | `load()`（缓存命中则直接返回，不重拉） | `rc2:…/ModelSelect.tsx:250-258`；`rc2:…/catalog.ts:56-70` |

这四个远程事件都在**转发表**里（`rc2:packages/api/remotes/src/remote-events.ts:37-38, 46, 52`），插件可以自行 `ctx.remote.$on(...)`。`源码契约`

**影子结论**：复用 `modelDirectories` → 以上全部免费且与 `/model` 同帧；自建 catalog → 必须照抄这张表，且会与原生目录形成两个不同步的 `pending`。本仓库的 ACP 面板已示范了另一种（更差的）模式：1s 轮询（`src/client/components/session-control-panel.tsx:139-150`）——不要用于选择器。

## 七、三个入口的一致性影响

| 入口 | 影子后行为 | 证据 |
| --- | --- | --- |
| composer 座位 | 我们的 tab 版；`/model` 写入后同帧反映（同一 `ModelDirectory`）；被寻址 subagent 会话不渲染 | 第一/三/四节 |
| `/model` 弹窗 | **不变**（原生 `popupSelect`，无 tab、不读 label）。`available` 与 `options` 都对 addressed subagent 抛错；失败 provider 作为不可选失败行；选中走 `directory.select` | `rc2:…/ui-model-selection/src/client/index.ts:126-165`；rc.3 `:1868-1898`、`optionsOf` `:1801-1826` |
| 设置页「模型」 | **不变**：它编辑 provider/模型目录与凭据，**不显示也不写入「当前模型」**，因此不构成第三个当前值来源 | `rc3:@deepseek-ai/dsh-client-ui-settings-models/README.md`（「Saving credentials or a custom provider preserves the selected model」） |
| 本仓库 ACP 面板 | 仍显示 ACP 侧 `模型/思考强度`（只读，1s 轮询），与 DSH 投影存在**一个请求的滞后**；`setSessionConfig` 拒绝写这两个 option | `src/client/components/session-control-panel.tsx:39-40, 251-256`；`src/host/service/acp-adapter.ts:293-298` |

**同一会话里会不会出现两个「当前模型」？** 会，但都不是影子新增的：

1. composer 座位（影子）与 `/model` 弹窗共享同一个 `ModelDirectory` → 同源，一致；
2. ACP 面板的 `模型` 是 **ACP config option 的 currentValue**，只有在下一个请求真正 `set_config_option` 之后才与 DSH 投影对齐（`src/host/service/acp-adapter.ts:744-770`）。用户在影子选择器里换模型后，面板最多会显示一个请求周期的旧值。

如果影子**不复用** `ModelDirectory`，就会出现第 3 个源（自建 pending 与原生 pending 分叉，`/model` 选完座位不亮），这是把「一个显示滞后」升级为「两个控件互相打脸」，必须避免。`源码契约` + `未实测`

## 八、降级策略、可测层与真机验收

### 8.1 降级矩阵

| 条件 | 策略 | 依据 |
| --- | --- | --- |
| `slots` 服务不存在（0.1 核心/精简组合） | 插件整体不 apply（`inject` 等待），宿主 provider 照常 | `src/client/index.ts:13`；`plugin 文档` `README.md:137` |
| 座位未声明 | `slots.inject` 静默等待，不报错 | `源码契约` |
| `modelDirectories` 服务不存在（`ui-model-selection` 未加载） | 不注册影子（`ctx.inject(['slots','modelDirectories'])`），座位留空/交给别家；**不要**为此自建目录 | 契约推导 |
| 注册抛错（同 priority、重复声明） | 自己 try/catch + `logger.warn`，返回空 disposer → 原生继续渲染 | `源码契约` |
| 影子渲染崩溃 | slot 引擎一次性 `abdicate` → 座位回落到原生注册者；会抛到 React error 边界并上报 `onEntryError`，之后**不再重挂**（要重新注册才恢复） | `rc2:…/scoped-slots.tsx:1127-1134`、`rc2:…/ui-slots/src/index.ts:1545-1553` |
| 需要一个总开关 | `slots.inject` 的回调里直接 `return () => {}`（或在设置快照为关时不 register）；切换开关需要 dispose 再 register（当前 API 没有「声明变更时重跑」以外的机制） | 契约推导 |
| 上游改引擎/改 priority | 只有「注册抛错」与「渲染崩溃」两条自愈通道；**没有**版本协商 API。影子是引擎行为而非文档化扩展点，升级即有风险（前一篇已记录） | `未实测` |

### 8.2 本仓库 client 测试能覆盖到哪一层

现状：`vitest` + 逐文件 `// @vitest-environment happy-dom`（`tests/client-session-control-panel.test.tsx:1`、`tests/client-import-view.test.tsx:1`），`react-dom/client` + `act` 挂载；`@deepseek-ai/dsh-client-ui-primitives` 走 `tests/stubs/dsh-client-ui-primitives.tsx` 别名（`vitest.config.ts:6-12`），类型走手写 shim `types/dsh-client-ui-primitives.d.ts`。`plugin 文档`

| 能覆盖 | 怎么覆盖 |
| --- | --- |
| 组件渲染：trigger 文案（模型 · effort）、root 两行、tab 列表与点击切换 | happy-dom + fake `directory.store`（`getSnapshot/subscribe`） |
| 搜索阈值（>4 才出现）、过滤、空态、组隐藏 | 直接断言 DOM |
| 键盘：↑/↓ 高亮、Enter/Tab 提交、Escape/Shift+Tab 收层、焦点回到 trigger | 派发 `KeyboardEvent` + 断言 `document.activeElement` |
| pending 态（spinner 顶替勾/chevron、行禁用） | 让 fake `select()` 返回未决 Promise |
| 失败提示（`session/writer-held` vs 一般错误）、菜单不关 | fake `select()` 返回 `{ok:false,error:{code,message}}` |
| 失败 provider strip / 加载 error strip + 重试 | fake store 的 `failures/status/error` |
| `locked` 只禁 trigger、subagent 会话返回 null | 传 props |
| 注册参数（`priority:-1`、无 `children`、`locale`） | 用记录型 fake `slots.inject/register`（本仓库还没有这类测试，是新增基建） |

| 覆盖不到 | 原因 |
| --- | --- |
| 真正的影子竞争、abdicate→原生回落 | 需要真实 `ui-slots` + `ui-renderer` 组合，本仓库不安装 |
| `modelCatalog()` / `selectModel()` 的真实 wire 行为、投影帧时序 | 只有 fake；Host 侧契约另由 DSH 上游测试覆盖 |
| 门户定位、吸顶、`data-model-compact` 收缩、CSS 令牌 | happy-dom 无布局（`getBoundingClientRect` 恒 0） |
| `/model` 与座位的同帧一致性 | 需要真实 `ModelDirectory` 双消费者 |

注意：若影子复用 `rankByName`/`MenuSurface`/`MenuGroup`/`StateDot`/`Toast`，本仓库的 primitives stub 与 shim **都要扩**（当前只有 `Button/Checkbox/Tag` + 5 个图标，`types/dsh-client-ui-primitives.d.ts` 同）。`plugin 文档`

### 8.3 真机验收步骤（沿用 `docs/dsh-verification-handoff.md` 的门禁与报告要求）

1. `node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/vitest/vitest.mjs run`、`node node_modules/tsdown/dist/run.mjs`；按 `docs/dsh-plugin-dev/06-install.md` link 到实际 profile。
2. 重启桌面端（provider 注册与 client bundle 都没有热更新）。
3. composer 座位：出现来源 tab（DSH + 每条已启用 ACP 路由），trigger 显示「模型 · effort」；点开无布局跳动。
4. `/model`：仍是原生无 tab 版；从 `/model` 选一个模型 → 座位那边**下一次渲染前**就换名；反向从座位选 → 再开 `/model` 的 active 行一致。
5. 选择失败路径：制造 `session/writer-held`（另开一个 DSH 实例占用同一会话）→ 座位弹「会话被占用」toast 且菜单不关。
6. Effort：选一个 agent 声明了 `thought_level` 的模型 → 出现 Effort 行；选等级后 pending spinner 顶替勾，落地后勾到新等级；无 reasoning 的模型 → Effort 行消失。
7. 搜索：模型 >4 才出现；输入只看某 tab 内命中；↑/↓ 不移焦点、Enter 选中、Esc 收回。
8. 键盘全链路：Tab 进 trigger → 打开 → ↑/↓ → Enter → 焦点回 trigger 且无 ring；Shift+Tab 逐层退。
9. 窄宽度：拖窄 composer，trigger 收成图标（`data-model-compact`），不被 tab 撑破。
10. 会话切换：两个会话各自当前模型/effort 不串；切回不保留搜索词与 tab 状态。
11. subagent 视图：打开被寻址的 subagent 会话 → 座位不出现（不是禁用）。
12. 停用一个 ACP 路由：其 tab 在一个刷新周期内消失；设置页行仍在（可重开）；该路由上的已保存选择请求时报错（`session/model-unavailable`）。
13. 账号登出：DSH tab 下的 account 组消失，投影保留不报错。
14. 自愈：临时让影子组件抛错（本地构建）→ 座位回落到原生选择器，且不再反复闪回（一次性 abdicate）。
15. ACP 面板：改一个非 model 的 config 仍生效；`模型/思考强度` 行只读，且在下一次请求后跟上影子的选择。

以上全部 `未实测`。

## 九、实现骨架（组件 / 状态 / 数据流）

### 9.1 文件与职责（建议）

```
src/client/
  index.ts                     # + 1 行注册（沿用 slots.inject 模式）
  register/model-seat.ts       # 影子注册、try/catch、开关
  components/model-seat.tsx    # 组件（trigger + menu + tabs）
  components/model-seat-panes.tsx  # source tabs / model pane / effort pane / status strip
  styles/model-seat.ts         # CSS（沿用 registerStyles 的 <style> 模式）
src/client/types/runtime.ts    # + modelDirectories 窄类型；+ 座位 props 类型
types/dsh-client-ui-primitives.d.ts + tests/stubs/...  # 若复用原语则扩
```

**已确认的类型缺口**（不补就编译不过）：`src/client/types/runtime.ts:59-67` 的 `SlotEntry` 只有 `name/id/key/order/locale/label/inject`，**没有 `priority`**。影子注册必须把它加成 `priority?: number`，否则 `-1` 无处安放；`SlotsService.inject`（`:69-72`）本身够用（回调返回 disposer 即可）。

### 9.2 组件与 props

```ts
interface SeatProps {                       // 由框架/owner 提供
  locked: boolean                           // ← owner props
  sessionId: string
  useSession: <S>(sel: (s: SessionSnapshot | undefined) => S, eq?: Eq<S>) => S
  useProjection: <K extends ...>(k: K) => ... // 'modelSelection'
  t: Translate                              // 注册时 locale: NS
  models: DirectoryFacade                    // ← inject: (sessionId) => ...
}

interface DirectoryFacade {                   // 只声明用到的最小面
  store: { getSnapshot(): DirectoryState; subscribe(fn: () => void): () => void }
  load(): Promise<DirectoryState>             // 打开菜单时调用（缓存命中即可）
  select(sel: Selection): Promise<RemoteResult<void>>
}
```

`DirectoryState`（与原生同形，`rc2:…/ui-model-selection/src/client/directory.ts:17-32`）：`{ current, groups, failures, status, pending, error, retainedEffort?, routable }`。

### 9.3 状态

```ts
const state = useSyncExternalStore(models.store.subscribe, models.store.getSnapshot)
const subagent = useSession(s => s.subagent)         // != null → return null
const projected = useProjection('modelSelection')    // 仅用于自算时的兜底（可选）

// UI 局部状态（切换会话由 remount 清空）
open, pane: 'root' | 'model' | 'effort', source: string /* tab id */,
query, highlightedIndex, selectionFocus, toast
```

派生（与原生同名同义，便于逐条对拍）：

- `sources` = `['dsh', ...acpRoutes]`（来源判定由票 #06 定；`groups` 按 provider id 归档，未归属的进「其他」或 DSH，需 #02 拍板）
- `groupsInSource` = `orderModelProviders(state.groups)` 过滤到当前 source → `rankByName(models, query)` → 隐藏空组
- `showSearch = choicesInSource.length > 4`（阈值口径待 #02 定）
- `currentChoice` / `reasoning` / `effectiveEffort` / `effortChoices` / `effortLabel`（照抄 3.3）
- `busy = state.pending !== null`

### 9.4 数据流

```
open menu ──► models.load()（缓存命中即返回；失败落 state.error/status）
     │
     ├─ render: state.groups ──► source tabs ──► 过滤/搜索/排序 ──► 行
     │                                                      └──► Effort pane
     └─ click row ──► models.select({provider, model[, reasoningEffort]})
                        │  (state: selecting + pending)
                        ├─ ok   ──► 关菜单 + 焦点回 trigger；current 由投影帧更新
                        └─ fail ──► Toast(session/writer-held | error.action)，菜单保持打开
```

**为什么不用 `ctx.remote.session` 直连**：那样 `current/pending` 与 `/model` 分叉（第七节），且要自己复制第六节全部订阅。直连只应作为「没有 `modelDirectories`」时的兜底，而那种情况下原生选择器也不存在，第一版直接不注册更省事。

### 9.5 风险 / 未知项

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 影子是引擎行为、非文档化扩展点 | DSH 升级可能改变渲染胜出规则；无版本协商 | 只在 `priority:-1`、不声明 children；注册 try/catch；每次升级跑 8.3 的 3/4/14 |
| label 插槽失效 | 第三方（含官方示例）模型名徽标消失 | 产品上接受，或在自绘行内做等价徽标（需要来源判定，#06） |
| 依赖内部服务 `modelDirectories` | 服务名/形状未文档化，可能改名 | 只声明最小面 + 运行时可选注入；缺失即不注册 |
| `directoryFor` 同步抛错（未知会话/无 binding） | 在 entry body 抛 → 影子被 abdicate（永不再挂） | 在 inject 工厂里 try/catch，返回 `null` face，组件渲染 `null` |
| 菜单定位/键盘工作量 | 交互回归风险最高 | `#04` 先用原型把键盘与定位跑通，再谈样式 |
| tab 与吸顶组标题的关系 | 视觉层级冲突（tab + provider 标题 + 行） | `#02` 决策：tab 内是否还要 provider 分组标题 |
| ACP 目录贵 | 频繁刷新触发探测会话 | 复用 catalog 缓存；不要在 tab 切换/每次 open 时重拉 |
| 影子与原生同时存在时 `/model` 写入门槛 | 影子只读不会造成写入冲突（两者都走同一个 `select`） | 别自己直连 RPC 即可 |

## 十、对本图的含义

**票 #02（来源 tab 交互规格）**

1. tab 必须建在「同一个模型列表」之上而不是新插槽：tab 只是 `state.groups` 的过滤视图，Effort/搜索/pending/失败条沿用同一套语义（第五节）。
2. 需要新定义的三件事：tab 的 `aria` 结构（上游没有先例）、搜索阈值按「当前 tab」还是「全目录」、未归属 provider 的落点。
3. 键盘规格必须在原型前定：↑/↓ 在「tab 条」与「模型列表」之间怎么切换焦点（推荐 Tab/Shift+Tab 走 tab 条、↑/↓ 只走行，避免和原生行导航冲突）。
4. label 徽标在 tab 版里**没有插槽可用**，要在规格里显式写「模型名行内自绘」或「放弃」。

**票 #04（最小原型）**

1. 先做三件事就能验证最大风险：`slots.inject` + `priority:-1` 注册成功、座位确实替换、`/model` 仍原生且两边同帧。
2. 原型即可复用 `ModelDirectory`（`directoryFor` 只读 store + `load/select`），不必写 Host 侧代码。
3. 键盘与门户定位是主要工作量；`rankByName`/`MenuGroup`/`MenuSurface` 复用能省掉一半细节，但要先扩 shim 与 stub。
4. 原型必须验「窄宽度收缩」与「subagent 不渲染」两个容易被忽略的回归面。

**票 #05（兼容 / 回退 / 验收）**

1. 回退边界是**三条**：未声明座位（静默）、注册抛错（try/catch→原生）、渲染崩溃（abdicate→原生一次性）。前两条可控，第三条是引擎给的免费自愈，但不可反复触发。
2. 0.1 核心与「无 `slots`」组合不需要特判：插件整体不 apply；「有 slots 无该 key」也不需要特判：`inject` 等待。
3. 验收必须包含：`/model` 未变更、设置页未变更、ACP 面板 `模型/思考强度` 只读且滞后一个请求、停用路由后 tab 消失但设置页行保留（8.3 的 4/12/15）。
4. 兼容矩阵里要把「影子是引擎行为」写成风险项，而不是支持承诺；上游一旦改动，只需保证「注册失败→原生仍在」。

## 主要一手来源

- rc.3 打包件（`app.asar` → `dsh/node_modules/@deepseek-ai/…`）：
  - `dsh-client-ui-model-selection/{README.md, lib/client.js}` — 座位注册、目录服务、排序、label 三处渲染、pending/toast、`/model` 选项构造。
  - `dsh-client-ui-conversation/lib/client.js` — 座位声明（`:20105`）、`modelSeatLocked`（`:19005`）、渲染点（`:19263`）。
  - `dsh-client-ui-renderer/lib/client.js` — `slots.inject`（`:1368-1423`）。
  - `dsh-api-session-controller/lib/{types/catalog.js, typert.remote-client.js}` — `buildModelCatalog`、`session/modelCatalog`、`session/selectModel` 的 strict schema 与 `sourceLocation`。
  - `dsh-client-ui-settings-models/README.md` — 设置页不含「当前模型」。
  - `dsh-web-frontend/dist/assets/index-BXV-oxvX.js` — slot 核心（minified）：未声明抛错、同 priority 抛错、priority 升序、`entriesOfSlot`。
- rc.2 可读源码（commit `687f282e`）：
  - `packages/client/ui-slots/src/index.ts`（注册/影子/abdicate）
  - `packages/client/ui-renderer/src/client/{registry.ts, scoped-slots.tsx}`（`slots.inject`、单座 dispatch、严格 session、错误边界）
  - `packages/client/ui-conversation/src/client/{apply.ts, contract/slots.ts, skeleton/InputBar.tsx, skeleton/control-row-layout.ts}`
  - `packages/client/ui-model-selection/src/client/{index.ts, service.ts, catalog.ts, directory.ts, ModelSelect.tsx, provider-order.ts, slots.ts}`
  - `packages/client/ui-session/src/client/index.ts`、`packages/api/session-controller/src/{types.ts, catalog.ts, commands.ts, agent.ts, model-selection-projection.ts}`、`packages/api/session-controller/src/client/{contract/snapshot.ts, sessions/projection-store.ts}`
  - `packages/api/remotes/src/remote-events.ts`、`packages/llm/llm/src/index.ts`、`packages/client/ui-primitives/src/rank-by-name.ts`
- 本仓库：
  - `src/client/index.ts`、`src/client/types/runtime.ts`、`src/client/register/{session-control-remote.ts, session-control-panel.ts}`
  - `src/client/components/session-control-panel.tsx`、`src/host/service/acp-adapter.ts`、`src/host/service/acp-agent.ts`
  - `types/dsh-client-ui-primitives.d.ts`、`tests/stubs/dsh-client-ui-primitives.tsx`、`vitest.config.ts`
  - `docs/dsh-plugin-dev/04-extension-points.md`、`docs/dsh-plugin-dev/09-compatibility.md`、`docs/dsh-verification-handoff.md`、`README.md`、`skills/engineering/dsh-plugin/SKILL.md`
