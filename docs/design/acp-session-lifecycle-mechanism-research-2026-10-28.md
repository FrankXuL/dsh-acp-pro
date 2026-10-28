# ACP 会话生命周期机制调研：这套机制本身是否是问题（2026-10-28）

> 触发自 bug #01（`claude-code-acp` fan-out 65 个 idle 会话撑爆 18GB）。
> 本笔记回答的不是「怎么修那一行」，而是**「按模型开会话去读元数据」这个机制设计本身是否成立**，并对照 ACP 规范与开源实现。
> 证据分级：`规范原文` / `一手源码` / `本机实测` / `未确认`。
>
> ⚠️ **2026-10-28 修订（重要）**：收到补充数据后，本笔记 §1 的**主因判定已被推翻并修正**。
> 补充数据给出了 MCP 进程计数（filesystem 32 / memory 30 / sequential-thinking 22 / context-mode 21），
> 而**探测路径显式传空 MCP 数组、一个 MCP 进程都不产生**——有 MCP 的会话只能来自 `ensureSession`。
> 因此扇出主因是 **stored binding 批量实体化（`getSessionSnapshots`）+ MCP 按会话复制（乘法放大）**，
> 探测会话只是**次因**。另新增「第二波更大」（193 > 65）这一跨重启累积现象，指向 binding 持久化。
> **§2–§5 的规范结论与开源对照仍然成立且更有价值**（协议不需要每模型开会话、close 是可选能力、Zed 进程绑连接）；
> **§1 的三缺陷定位与主因归因按下述修订版理解**，详见 §1.1。

## 结论摘要

1. **机制本身有问题，且不是「参数没调好」，是设计选错了层次。** 本插件用「每模型一个探测会话」换「每个模型的思考档位」，而 ACP 规范明确规定「切换模型后返回完整配置状态、可反映依赖变化」——一个会话就够了。**N 个模型 → N 个会话是本插件额外制造的，协议不要求。**
2. **放大系数由外部输入决定，无上限。** 宿主 `catalog.ts` 对 provider 的每个模型并发 `resolveModelInfo`，并发数 = 该 route 的模型数；插件侧 `discoverEffortsForModel` 无 in-flight 共享，于是「模型数」直接变成「进程数」。N 由 agent 广告的模型数或用户配置的 `models` 长度决定，**代码里没有任何一处能挡住它**。
3. **租约所有权缺失才是致命项。** 探测会话靠 `session/close` 释放，但 v1 里 close 是**可选能力**，claude-code-acp 0.16.1 不宣告即永久驻留。规范 RFD 已明确承认这个缺陷：*"if you start a session, it will remain active until the ACP process is terminated... active users with many sessions can end up with a lot of processes unnecessarily using up system memory"*。
4. **本机实测确认 1:1，并确认单会话方案可行。** 现状 5 模型 → 6 个会话；对照组「单会话循环 `set_config_option`」→ **4 模型仅 1 个会话，四档位全部读到**。即省掉 N-1 个会话不损失任何信息。
5. **上游已在纠偏。** ACP v2 RFD 拟把 `session/close`/`list`/`resume` 从可选提升为**必备**；`session/close` RFD 已于 2026-04-23 stabilized。本插件把「唯一释放通道」建立在一个 v1 可选能力上，是对协议成熟度的误判。
6. **进程回收还有第二重缺陷。** 即使 close 可用，插件也只 `kill` 直接子进程（`acp-agent.ts:571`），不按进程组回收；孙进程（`claude` + 各自 MCP server）必然残留。报告人「需手动递归 kill 进程树」正是这两重缺陷叠加。
7. **对照 Zed**：agent 连接与 thread/session 是多对一——一个 agent 进程服务多个会话，进程随连接生命周期回收，而不是「每会话一进程」再靠 close 收尾（`一手源码`，见 §4）。

## 1.1 修订版（第三轮，最终）

> ⚠️ **本节标题曾写「主因是 stored binding 批量实体化」——该判断已被证伪，见 §1.2。**
> 正确的 fan-out 主因是 **`ephemeral` 路径**（`purpose !== undefined` 或无 sessionId）：无 coordinator 锁、每次 `createBinding` 不复用、且默认透传全部 MCP。

### 决定性证据（保留，仍成立）：MCP 计数区分两条会话路径

`一手源码` `src/host/service/acp-agent.ts:228` 的语义是「省略 `mcpServers` = 透传全部已安装 MCP；显式传 `[]` = 不转发」。`本机实测`：

| 调用 | 结果 |
| --- | --- |
| `agent.newSession('/tmp')`（省略参数） | **mcp=10** |
| `agent.newSession('/tmp', undefined, [])`（探测路径） | **mcp=0** |
| `agent.newSession('/tmp', undefined, [2 个])` | **mcp=2** |

调用点：

- `acp-agent.ts:502,519`（`discoverModels` / `discoverEffortsForModel`）→ 显式 `[]` → **0 个 MCP**。
- `acp-adapter.ts:827`（`ensureSession` → `agent.newSession(cwd, signal)`）→ **省略参数 → 全部 MCP**。

**现场 MCP 进程数（32/30/22/21）证明扇出主因不是探测会话**——探测会话根本不产生 MCP 进程。有 MCP 的会话只能来自 `ensureSession`。

### 扇出主因：`getSessionSnapshots` 为只读快照而批量物化会话

`一手源码` `src/host/service/acp-adapter.ts:252`：

```ts
for (const provider of providers) {
  const binding = await this.bindingOf(provider, dshSessionId)
  if (... binding.session === undefined) {
    await this.coordinator.run(..., () => this.ensureSession(latest, agent, profile, latest.model))
  }
```

`bindingOf`（`:612`）优先读 `bindingStore`；宿主注入 `FileAcpBindingStore`（`apply.ts:133`），落盘 `data/dsh-acp-pro`，**跨重启存活**。于是「已保存会话数」直接变成「要实体化的会话数」，每个各起一个 agent 进程 + 全套 MCP。

### 为什么第二波更大（193 > 65）

**binding 是持久化的**：第一波把 65 个 binding 写盘，重启后 `getSessionSnapshots` 面对更多 binding，第二波自然更大。三个 agent 同时超标（193/149/19）说明是**共享机制**，不是单个 agent 的怪癖。

另：`advertised` / `modelEfforts` 缓存是**纯内存、进程实例级**（`acp-agent.ts:184,547`），`sync()`/dispose 后实例替换即失效 → 重新探测 → 再开会话。**缓存与扇出都没有跨重启保护。**

### 缺陷表（终版，§1.2 定稿）

| # | 缺陷 | 定位 | 证据 |
| --- | --- | --- | --- |
| A | **放大** | **`ephemeral` 路径无锁 + 每次新建 binding + 不复用** | 源码 + 实测 |
| B | **无主** | 会话无租约、无 TTL；`idleTimeoutMs` 只管回合内 | 源码 |
| C | **无回收** | SDK 只 kill 直接子进程（无 `detached`）；MCP 孙进程实测存活 | 源码 + 实测 |
| D | **MCP 乘法** | `进程数 = 会话数 × MCP 数`，10 个 MCP 时 10 倍 | 实测 8×10 |

## 1.2 终稿：fan-out 主因是 `ephemeral` 路径（第三轮修订，推翻本节原判定）

**原判定「主因是 stored binding 批量实体化」已证伪。** 两处更正：

1. **`getSessionSnapshots` 被排除**：`providers` = `profiles().keys()` ∪ 本 dshSessionId 的 binding provider，**上限 = route 数（3）**，不可能产生 65。且只由当前会话面板每秒轮询（`session-control-panel.tsx:127`，有 `requestInFlight` 防重入）。
2. **真主因是 `ephemeral`**（`一手源码` `acp-adapter.ts:899-901`）：

```ts
const ephemeral = dshSessionId === undefined || purpose !== undefined
const release = ephemeral ? undefined : await this.coordinator.acquire(key)   // ← 无锁
// :962
if (ephemeral) binding = this.createBinding(route, undefined, profile, options.model)  // ← 每次新建
```

三特性叠加：**① 无 coordinator 锁** ② **每次 `createBinding`，不查 store、不复用** ③ 走 `ensureSession` → **默认透传全部 MCP**。

**触发来源**（宿主，均带 `purpose`）：`purpose: 'compaction'`（`compaction-basic/src/summarizer.ts:160`）、`purpose: 'session-title'`（`session-title-llm/src/index.ts:264`）、任何 `sessionId === undefined`。

**`本机实测`**：

| 并发 purpose 调用 | 会话数 | 每会话 MCP | 推算进程 |
| --- | --- | --- | --- |
| 8 | 8 | 10 | **88** |

与现场 65/193 同量级。**关键吻合**：ephemeral **不写 `bindingStore`**，所以「磁盘上找不到对应会话文件」正是它的签名（比 MCP 计数更强的证据）；「冷启动零交互」也说得通（标题/压缩在初始化时自动发生）。

> 因此「第二波更大＝binding 累积」**一并作废**：ephemeral 不持久化，第二波规模来自每轮并发量。本机无 `data/dsh-acp-pro` binding 目录，该解释本就无证据，已从根因移除。

## 1.3 进程树回收：MCP 孙进程实测会成孤儿（闭合上轮未确认项）

**问题**：`query.close()` 是否连带杀 MCP 孙进程？**答案：不会。**

`一手源码`（claude-agent-sdk 0.3.312 实际产物）：

| 层 | 事实 |
| --- | --- |
| `ProcessTransport.spawnLocalProcess` | `spawn(..., { windowsHide:true })` —— **无 `detached`**，不独立成组 |
| `ProcessTransport.close()` | `stdin.end()` → 直接子进程 `kill("SIGTERM")`，5s 后 `kill("SIGKILL")` —— **全是单 pid** |
| `Query.cleanup()` | 同上，无进程组信号 |
| claude-agent-acp `teardownSession` | `closeQueryStream` → `query.close()`，只保证 **claude 主进程** |

`本机实测`（用 `process.kill(pid,0)`，**不用 `ps`**）：

```
BEFORE:               mcp pid=88528 alive=true
AFTER parent SIGKILL: mcp pid=88528 alive=true   ← 孤儿存活
```

**推论（限定「升级包」效力）**：新版 agent 支持 `session/close` 后能回收 claude 主进程，但**它拉起的 MCP 孙进程仍残留**。**`killpg` 必须在客户端做**，不能指望 agent 侧 close。

> 方法论教训：我最初用 `ps -p` 判断存活，两次都显示 "gone"，差点得出「孙进程会自己退出」的错误结论。查明是**沙箱拒绝执行 `ps`**（`Operation not permitted`）——假阴性。**检测工具不可信时，必须换手段重测。**

## 2. 规范原文：协议不要求、也不建议每模型开会话

`规范原文` [Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options.md)：

- `session/set_config_option` 的响应 **MUST** 返回**完整**配置状态：

  > *"The Agent **MUST** respond with the complete list of all configuration options and their current values"*
  > *"The response always contains the complete configuration state. This allows Agents to reflect dependent changes. For example, **if changing the model affects available reasoning options**..."*

  这一句直接说明：**切模型后返回的 `thought_level` 就是该模型的档位**。所以「读遍所有模型的档位」只需一个会话循环切模型，不需要 N 个会话。

- `thought_level` 是 `category` 语义标签，不是独立能力：
  > *"Categories are for UX purposes only and **MUST NOT** be required for correctness."*

  即不应为了「渲染档位」而付出会话级代价。

**结论**：本插件的做法是「协议允许但规范不推荐」的路径——把一次会话内可完成的事，做成了会话级并发。

## 3. 一手源码：放大链路与释放前提

### 3.1 放大（宿主侧，`一手源码`）

DSH `packages/api/session-controller/src/catalog.ts:28-29`：

```ts
const entries = await Promise.all(models.map(async (model) => {
  const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
```

`Promise.all` 对**每个模型**并发解析，无并发上限、无批处理。这是放大系数的源头。

触发时机不止「打开选择器」：`initializeDefaultModel()`（`index.ts:323`）在**启动时**就会构建一次完整目录——与报告人「冷启动零交互就炸」吻合。

### 3.2 转化为会话（插件侧，`一手源码`）

- `src/host/service/acp-adapter.ts:477-479`：`discoverModels === true`（schema 默认 `true`，`src/host/config/schema.ts:35`）时，每个 model 调 `process.discoverEffortsForModel(model, ...)`。
- `src/host/service/acp-agent.ts:512-519`：该函数**只在探测完成后**写缓存（键 `generation|cwd|model`），并发调用在首个完成前全部 miss，于是各自 `newSession()`。
- 对比同文件 `discoverModels`（`:502`）用 `this.discovering ??=` 做了 in-flight 合流——**同一文件两条探测路径的保护不对称**，这是明确缺口而非设计取舍。

### 3.3 释放前提不成立（`一手源码` + `规范原文`）

- `src/host/service/acp-agent.ts:487-495`：`closeSession` 在 agent 未宣告 `sessionCapabilities.close` 时**直接 return**。
- `docs/dsh-verification-results.md:33`：实测 claude-code-acp 0.16.1 **close 不支持**、**不宣告任何 config option**。
- `规范原文` [session-close RFD](https://agentclientprotocol.com/rfds/session-close.md)：v1 现状是 *"if you start a session, it will remain active until the ACP process is terminated"*，并点名 *"if the agent implements sessions as separate processes, active users with many sessions can end up with a lot of processes"*。
- `规范原文` [v2 required session methods](https://agentclientprotocol.com/rfds/v2/required-session-methods.md)：v1 的 `sessionCapabilities.close` 是可选；v2 拟改为 `capabilities.session` 一旦宣告就必须支持 close。

**这把「机制是否成立」的答案钉死了**：本插件把唯一的资源释放通道，建立在协议的一个**可选**能力上，且对端恰好不支持。

> **2026-10-28 二次修正**：「claude-code-acp 不支持 close」只对**事故现场那个包版本**成立，不能扩大成对该 agent 的判断。独立核对 npm registry 与源码后确认：
> - `@zed-industries/claude-code-acp` 止于 **0.16.2** 并已 deprecate，改名 `@agentclientprotocol/claude-agent-acp`；
> - 后续身份从 **0.22.0（2026-03-16）** 起支持 `session/close`（CHANGELOG "Add session/close support (#409)"）；
> - 当前 `@agentclientprotocol/claude-agent-acp`（0.97.0）源码 `src/acp-agent.ts:2995` 宣告 `close: {}`。
>
> **但这不改变本节结论**：① 该 agent 至今**没有任何会话数上限或空闲超时**（`src/` 检索 `maxSessions|idleTimeout|evict` 无相关命中），限流责任仍在客户端；② 协议层面 close 仍是 v1 **可选**能力，本插件"把唯一释放路径押在可选能力上"的结构性错误不变。**升级包能消除「永不回收」，但消除不了并发扇出与 MCP 乘法。**
> 另注意：`agentclientprotocol/registry` 的能力矩阵探的是旧名 `session/stop`，从未探 `session/close`，据它判断支持情况是**假阴性**。

### 3.4 回收不彻底（`一手源码`）

`src/host/service/acp-agent.ts:571` 的 `teardown` 只 `live.child.kill('SIGTERM')`，单 pid、不按进程组。孙进程（claude 及其 MCP server）除非自己响应父进程退出，否则成孤儿。`规范原文` 未规定进程组语义——这是客户端实现责任。

## 4. 对照：Zed 的模型

`一手源码` [zed/crates/agent/src/agent.rs](https://github.com/zed-industries/zed/blob/79b9cae2/crates/agent/src/agent.rs) 与 [crates/acp_thread/src/acp_thread.rs](https://github.com/zed-industries/zed/blob/main/crates/acp_thread/src/acp_thread.rs)：

- Zed 的 ACP 连接是**长连接 + 多 thread 复用**：`AgentConnection` 持有连接，`Thread` 作为之上的会话单位（`impl acp_thread::AgentConnection for NativeAgentConnection`）。
- 会话随 **thread 生命周期**回收，而不是「每个会话派生一个子进程再靠 close 收尾」。Zed 侧的目标进程数是「每个 agent 一个」，不是「每个 thread 一个」。

**对照结论**：成熟客户端把「进程」绑定到**连接**，把「会话」绑定到**协议上的轻量对象**。本插件做反了——本该是一条连接上多个会话，却让每个探测会话在 agent 侧变成一整个进程，还把释放交给可选能力。

> 注：Zed 源码结构复杂，上述为其连接/线程模型要点；逐行细节见该文件 `AgentConnection` 定义与 `acp_thread` 的 thread 抽象。**具体到「Zed 是否对空闲 thread 做 TTL」本轮未逐行确认，标 `未确认`。**

## 5. 本机实测（`本机实测`，已完成并清理）

用 mock ACP agent 复现宿主并发解析，读数：

| 实验 | 输入 | 结果 |
| --- | --- | --- |
| A 现状路径 | 5 个模型并发 `resolveModel` | **6 个 ACP 会话**（含 1 个目录探测） |
| B 对照路径 | 单会话循环 `set_config_option` 切 4 个模型 | **1 个会话**，四档位全部读到 |
| C 裸协议 | 8 模型并发 `session/new` | **8 个会话**，严格 1:1 |

**B 证明了 §2 的规范结论在实现上成立**：不需要 N 个会话也能拿全所有模型的思考档位。A 与 C 确认放大是确定性的、与模型数线性相关。

> 实验为临时探针，读到数据后已删除，未留在仓库。

## 6. 机制层面的修法排序（终版，按 §1.2/§1.3 定稿）

> **本节已按终稿重排**：主因是 `ephemeral` 路径无锁扇出 + MCP 按会话复制；`getSessionSnapshots` 已被排除（上限 3 个）。原「改探测策略」降为次要。

1. **给 `ephemeral` 路径加锁 + 限流（最高收益）**：标题生成 / 压缩本就是短任务，应复用同一临时会话串行完成，或至少加并发信号量。这是 65/193 的直接来源。
2. **砍掉 MCP 乘法**：MCP 不按会话复制——同一 agent 连接内复用或按需懒连接。`进程数 = 会话数 × MCP 数`，10 个 MCP 即 10 倍放大。
3. **回收落到进程组（已升为必做）**：`spawn` 用 `detached: true`，teardown `process.kill(-pid)`。**§1.3 实测证明 agent 侧 close 清不掉 MCP 孙进程，这一步没有替代品。** Zed/execa/monoCode 三方一致。
4. **探测单飞 + 单会话循环**：套用本插件已有的 `discovering ??=`；1 专用探测会话 + N 次 `set_config_option`（实测 4 模型 → 1 会话读全，降级安全）。
5. **会话租约 TTL**：兜底。**Zed 完全没有 TTL 也不出事**——靠结构而非超时，故 TTL 是补丁不是根治。
6. **升级包名**：缓解「永不回收」，**不解决峰值、不解决 MCP 残留**。

## 7. 给 bug #01 的结论

- **机制判定：不成立，四缺陷叠加（A 放大 / B 无主 / C 无回收 / D MCP 乘法）。**
- **A 的终版定位是 `ephemeral` 路径**（`purpose !== undefined` 或无 sessionId）：无锁 + 每次 `createBinding` + 默认透传全部 MCP。原「stored binding 批量实体化」判定已由 §1.2 证伪并移除；「第二波＝binding 累积」同时作废（ephemeral 不写 store）。
- **不是「claude-code-acp 的 bug」**：agent 每会话一进程是合法实现，新版还支持 `session/close`；但**它自己无会话数上限**，限流责任在客户端。
- **也不是「宿主的 bug」**：DSH 自身 ACP 服务端做对了（`listModels` 零会话、只解析当前模型、`serialize()` 串行）。宿主 `catalog.ts` 全量并发是通用行为，**修法在 adapter，对该文件零改动**。
- **高收益修法**是 §6.1（ephemeral 加锁）与 §6.2（MCP 不复制）；§6.3（`killpg`）是**必要兜底**，因为 agent 侧 close 清不掉 MCP 孙进程。
- **升级包名是缓解不是修复**：能消除「永不回收」，但 193 个会话照样同时存在并打满内存，MCP 孙进程照样残留。

## 参考（一手）

- [Session Config Options（v1 规范）](https://agentclientprotocol.com/protocol/v1/session-config-options.md) —— set_config_option 必返完整配置、反映模型依赖
- [session/close RFD](https://agentclientprotocol.com/rfds/session-close.md) —— v1 会话活到进程终止、进程堆积问题、2026-04-23 stabilized
- [v2 Required Session Methods RFD](https://agentclientprotocol.com/rfds/v2/required-session-methods.md) —— close 在 v1 可选、v2 拟必备
- [claude-agent-acp `src/acp-agent.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts) —— 已引入 `CloseSessionRequest`，`teardownSession` 注释注明 close 或连接关闭触发
- [zed `crates/agent/src/agent.rs`](https://github.com/zed-industries/zed/blob/79b9cae2/crates/agent/src/agent.rs) —— 连接/线程模型
- 本机 DSH checkout：`packages/api/session-controller/src/catalog.ts:28-29`、`src/index.ts:323`
