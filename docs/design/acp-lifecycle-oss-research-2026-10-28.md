# ACP 会话生命周期：开源实现调研（2026-10-28）

**检索日期：2026-10-28。** 本文只回答一个问题：开源 ACP 生态里，客户端与 agent 各自用什么机制避免「会话数 → 进程数」的扇出，以及怎么回收空闲会话与孤儿进程。

**证据层级：**

| 层级 | 含义 | 标记 |
| --- | --- | --- |
| A | 一手源码：固定 commit 的文件 + 行号 | `一手源码` |
| B | 官方协议 schema / 官方文档 / RFD | `规范原文` |
| C | 无法从源码确认（含 schema 字段缺失、探测工具口径不一致） | `未确认` |

**固定版本（本文所有链接的 commit）：**

| 仓库 | commit | 时间 |
| --- | --- | --- |
| [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp/tree/059d76e14a20e533846954c64ac5adcda2cf5d80) | `059d76e14a20e533846954c64ac5adcda2cf5d80` | 2026-10-27 |
| [zed-industries/zed](https://github.com/zed-industries/zed/tree/37faef81f74fc1bb08be9939c4cffc8ede6ced2f) | `37faef81f74fc1bb08be9939c4cffc8ede6ced2f` | 2026-10-27 |
| [agentclientprotocol/agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol/tree/aa3cca0f36818591a57ed313db34b7e6a1142b49) | `aa3cca0f36818591a57ed313db34b7e6a1142b49` | 2026-10-27 |
| [hardbeat920/monocode](https://github.com/hardbeat920/monocode/tree/26465c620977f3951d0a532a0f7db32c3c179007) | `26465c620977f3951d0a532a0f7db32c3c179007` | — |
| [zvzuola/acp-components](https://github.com/zvzuola/acp-components/tree/1708c20274c9f15ee3a072009e5ca9fd3b71a9de) | `1708c20274c9f15ee3a072009e5ca9fd3b71a9de` | — |
| [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp/tree/296069e841634cd4bb9bc4515602d836e49231ec) | `296069e841634cd4bb9bc4515602d836e49231ec` | — |
| [sindresorhus/execa](https://github.com/sindresorhus/execa/tree/247faa0ff0641020e8790475989cee72df85d62b) | `247faa0ff0641020e8790475989cee72df85d62b` | — |
| [nodejs/node](https://github.com/nodejs/node/tree/79c1fc4fbb2c30c07b0d3f2bef90445d26c9e1b2) | `79c1fc4fbb2c30c07b0d3f2bef90445d26c9e1b2` | — |

> 注：本次固定的 `claude-agent-acp` 已是 `0.97.0`，与事故现场的 `@zed-industries/claude-code-acp 0.16.1` 不是同一代产物。两代在 `session/close` 上的差异是本文的关键前提，见 §2.2。

## 结论摘要

1. **Zed 是「一个 agent 一个进程、一个 workspace 内所有 thread 共用这一条连接」**——进程绑定连接，会话只是连接上的逻辑对象。`AgentConnectionStore` 的 key 是 `HashMap<Agent, …>`，不是按 thread/session（`一手源码`）。
2. **Zed 没有任何 idle TTL / 会话数上限 / 空闲会话驱逐器**。会话的回收靠两件事：thread 视图释放时显式 `close_session`，以及连接对象被 drop 时子进程被 `killpg` 连带杀掉（`一手源码`）。
3. **Zed 对 `session/close` 是「按能力协商、拿不到就跳过」，不是硬依赖**：`supports_close_session()` 返回 false 时 `close_all_sessions()` 直接返回 Ok，不报错（`一手源码`）。
4. **`claude-agent-acp` 确实是「一个 `session/new` = 一个 `claude` 子进程」**：`createSession()` 里 `query()` 立刻 spawn CLI，并把 query 存进 `this.sessions[sessionId]`（`一手源码`）。
5. **`claude-agent-acp` 现在支持 `session/close` 并在 `initialize` 宣告 `close: {}`**；但它**没有**任何 maxSessions / 空闲超时 / 会话数限制。唯一的总回收点是连接断开（stdin EOF / SIGTERM → `shutdown()` → `dispose()` 遍历关闭所有会话）（`一手源码`）。
6. **`session/close` 在 ACP v1 是可选能力**：schema 明确写 "Optional. Omitted or `null` both mean the agent does not advertise support"；RFD 于 2026-04-23 标记 Completed 而稳定化（`规范原文`）。
7. **`NewSessionResponse` 直接返回全量模型列表与当前模型的 `thought_level`**，不需要「切模型才读得到」；但**没有**「列出每个模型各自档位」的接口——`thought_level` 选项只描述**当前**模型（`一手源码` + `规范原文`）。这是客户端「每模型开一个会话」的唯一动机来源，也是它不成立的证据。
8. **进程树回收的可靠做法是「spawn 时自成进程组/会话 + 按组信号」**：Unix `detached:true`（Node）或 `process_group(0)`（Rust）后 `kill(-pid)` / `killpg`；Windows 用 `taskkill /T /F` 或 Job Object。execa、monoCode、Zed 三处独立实现一致（`一手源码`）。

## 1. Zed（ACP 客户端）

**结论：** 进程数 = agent 数，不是会话数。一个 project 的 `AgentConnectionStore` 为每个 `Agent` 维护**一条**连接（一个子进程），该连接上可以开任意多个 ACP session。会话关闭靠 `close_session`（能力协商，可选），进程回收靠连接对象 drop 时对**整个进程组**发 `SIGKILL`。没有 idle TTL，没有会话数上限。

### 1.1 几对几：进程 : 会话 = 1 : N

- 连接缓存以 **`Agent`** 为键，一个 project 一份：`entries: HashMap<Agent, Entity<AgentConnectionEntry>>` — [`zed/crates/agent_ui/src/agent_connection_store.rs:89`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/agent_connection_store.rs#L89)
- `request_connection()` 命中已有 entry 就直接复用，不再 spawn：同文件 `:186-194`。
- 进程在连接建立时 spawn 一次：`transport::spawn_stdio(&project, command, cx)` — [`crates/agent_servers/src/acp/v1.rs:540-557`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v1.rs#L540-L557)；`v2` 同构，见 [`crates/agent_servers/src/acp/v2.rs:235`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v2.rs#L235)。
- **一个 thread 才开一个 session**，且用的是共享 connection：`connection.clone().new_session(project.clone(), session_work_dirs, cx)` — [`crates/agent_ui/src/conversation_view.rs:1438-1443`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/conversation_view.rs#L1438-L1443)。注意 `new_session` 是 `AgentConnection` 上的方法，走的就是那条已被缓存的连接。

> 所以 Zed 的模型是：**进程是 agent 级（per project × per Agent），会话是 thread 级**。N 个 thread 共享 1 个进程，不存在「会话数 → 进程数」的扇出。

### 1.2 会话什么时候关闭

- 能力探测：`agent_supports_session_close()` = `session_capabilities.close.is_some()` — [`crates/agent_servers/src/acp/v1.rs:907-909`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v1.rs#L907-L909)。
- **拿不到能力就安静跳过**：`close_all_sessions()` 第一句 `if !self.connection.supports_close_session() { return Task::ready(Ok(())) }` — [`crates/agent_ui/src/conversation_view.rs:1024-1026`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/conversation_view.rs#L1024-L1026)。这是「可选能力」的正确消费方式：**不把它当作唯一释放路径**。
- 逐会话发 `session/close` 并 `join_all` 收集失败：同文件 `:1027-1049`。
- 关会话的时机是 **thread 视图释放 / server state 切换**：`release_sessions()` 由 `cx.on_release`（`:1106-1112`）和 `set_server_state`（`:1173-1176`）触发，`release_sessions` 再按 `should_close_sessions_on_release()` 决定是否真关 — 同文件 `:1052-1058`。
- 一个容易漏的细节：**`session/new` 成功但本地注册失败时，Zed 会主动 close 掉这个已建成的会话**，避免泄漏 — [`crates/agent_servers/src/acp/v1.rs:1335-1352`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v1.rs#L1335-L1352)（`if !registered && supports_close { … CloseSessionRequest … }`）。
- v2 明确**不**在视图释放时关会话：`should_close_sessions_on_release()` 注释为 "V2 close cancels agent-owned work; disposing a view must only detach." 并返回 `false` — [`crates/agent_servers/src/acp/v2.rs:1598-1601`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v2.rs#L1598-L1601)。v2 的 `supports_close_session()` 只要求「宣告了 session 能力」：`:1451-1453`。

### 1.3 有没有 idle 超时 / 最后一个会话关闭即杀进程

- **没有 idle 超时。** 在 `crates/agent_ui`、`crates/agent_servers`、`crates/acp_thread` 内检索 `idle_timeout` / `idleTimeout` / `IDLE_TTL` / `idle_ttl`，命中 0（`一手源码`，见本文检索说明）。
- **没有「最后一个会话关了就杀进程」。** 进程活在**连接**的生命周期里，而连接活在 **`AgentConnectionStore`**（即 project）的生命周期里：
  - store 释放 → `shutdown_connections()` 遍历所有连接调 `shutdown()` — [`crates/agent_ui/src/agent_connection_store.rs:115-125`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/agent_connection_store.rs#L115-L125)，由 `cx.on_release` / `cx.on_app_quit` 触发（`:100-103`）。
  - v2 的 `shutdown()` 只是 `drop` 掉 runtime — [`crates/agent_servers/src/acp/v2.rs:1258-1261`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v2.rs#L1258-L1261)。v1 `AcpConnection` 不覆写 `shutdown()`（trait 默认空实现，[`crates/acp_thread/src/connection.rs:107`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/acp_thread/src/connection.rs#L107)）。
  - **真正杀进程的是 Drop，不是 shutdown**：`pub(super) struct OwnedChild(pub Child);` + `impl Drop for OwnedChild { self.0.kill() }` — [`crates/agent_servers/src/acp/transport.rs:14-20`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/transport.rs#L14-L20)，该字段通过 `_child: Option<transport::OwnedChild>` 挂在连接上（[`crates/agent_servers/src/acp/v1.rs:87,742`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v1.rs#L87)）。
  - 而 `Child::kill()` 是**整组杀**，见 §5.2：`libc::killpg(pid, SIGKILL)`（[`crates/util/src/process.rs:113-119`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/util/src/process.rs#L113-L119)）。

> 一句话：Zed 不需要 idle 超时，因为它的常驻进程数本来就等于 agent 数（小常数），而不是会话数。

## 2. claude-agent-acp（agent 侧）

**结论：** 是 1:1——每个 `session/new` 派生一个 `claude` 子进程，`query()` 立即 spawn。当前版本支持 `session/close` 并在 `initialize` 宣告 `close: {}`；**但 SDK 侧没有任何并发会话上限或空闲超时**，唯一的总兜底是「连接断开即 dispose 全部会话」。所以「会话数 = 进程数」在 agent 侧是无约束的，回收责任**全在客户端**。

### 2.1 每个 `session/new` 真的派生一个子进程

- `newSession()` → `createSession()` — [`src/acp-agent.ts:3079-3087`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L3079-L3087)。
- `createSession()` 内部 `const q = query({ prompt: input, options })`，注释直接写明 **"`query()` spawns the CLI at once"** — [`src/acp-agent.ts:11961-11969`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L11961-L11969)。
- 每个会话的 `sessionId` 由 `randomUUID()` 生成并作为 `options.sessionId` 传给 SDK — 同文件 `:11507-11524`、`:11953-11956`。这正是事故现场「各带不同 `--session-id`」的来源。
- query 与子进程句柄按 sessionId 存进 map：`this.sessions[sessionId] = { query: q, input, … }` — [`src/acp-agent.ts:12202`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L12202)。
- 有防泄漏意识但只覆盖「注册前失败」：`discardUnregisteredQuery()` 会把 spawn 了却没进 map 的 query `close()` 掉 — [`src/acp-agent.ts:9062-9075`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9062-L9075)（调用点 `:12285`，对应 `:11969` 的注释）。

### 2.2 支持 `session/close` 吗、什么版本开始

**支持，且是「稳定化后」的功能。**

- 能力宣告：`sessionCapabilities` 里 `close: {}` — [`src/acp-agent.ts:2993-3001`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L2993-L3001)。
- 处理函数：`async closeSession(…)`，幂等，未加载的 session 直接返回 `{}` — [`src/acp-agent.ts:9195-9202`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9195-L9202)；方法注册 `methods.agent.session.close` — `:14189`。
- `teardownSession()` 才是实际释放：取消在跑的 turn → `closeQueryStream()`（`session.query.close()`，注释明确 "**which terminates the subprocess**"）→ 从 map 删除 — [`src/acp-agent.ts:9118-9152`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9118-L9152) 与 `closeQueryStream` 的文档注释 `:9076-9098`。
- **版本落点（两条证据）**：
  - `CHANGELOG.md` 在 **0.22.0** 节写 "Add session/close support (#409)" — [CHANGELOG.md:1168](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/CHANGELOG.md#L1168)。对应 PR 元数据：title "Add session/close support"、merged_at `2026-03-13T15:53:22Z`、merge_commit `2193a13a…`（GitHub API 读取 PR #409，`未确认`其与本文 commit 之间无 revert——未逐 commit 追）。
  - npm 上 `@zed-industries/claude-agent-acp` 的 `0.22.0` 发布于 `2026-03-16T19:43:27Z`；`@zed-industries/claude-code-acp` 的版本序列**终止于 `0.16.2`（2026-02-17）**，并被 deprecate 为 "This package has been renamed to @agentclientprotocol/claude-agent-acp"。

> ⚠️ **对事故结论的修正**：事故现场用的 `@zed-industries/claude-code-acp 0.16.1`（2026-02-10）**早于** close 支持约一个月，所以「该版本不支持 `session/close`」是成立的。但把它写成「claude-code-acp 不支持 close」会误导——**这个包的后续身份是 `@agentclientprotocol/claude-agent-acp`，从 0.22.0 起支持**。升级包名是消除「探测会话永不回收」的最短路径之一（但不解决 §2.3 的无上限问题）。

### 2.3 它自己有没有并发会话数 / 空闲 / 子进程回收限制

**没有会话数上限，也没有空闲超时。**

- 在 `src/`（排除 tests）检索 `maxSessions` / `MAX_SESSIONS` / `idleTimeout` / `IDLE_TIMEOUT` / `maxConcurrent` / `concurrency` → **0 命中**。`this.sessions` 是全量 map，只在 `teardownSession` / `dispose` / 自然流结束（`closeQueryStream`）时删条目。
- 唯一的总兜底是**连接级**：`async dispose()` = 遍历所有 session 调 `teardownSession` — [`src/acp-agent.ts:9189-9192`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9189-L9192)。它由 stdio 连接关闭触发：`acp.closed.then(shutdown)`，`shutdown()` 调 `acp.dispose()` — [`src/index.ts:90-106`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/index.ts#L90-L106)，注释直说这是为了修 "orphan process accumulation in oneshot mode"。
- 但 `dispose()` 只是在**本进程内**调 `query.close()`。`query.close()` 能否连带杀掉 `claude` 的**子孙**（MCP server）取决于 SDK / CLI，**本文未在源码中确认**（`未确认`）。这与 §5 的「客户端要自己按进程组兜底」并不矛盾——客户端仍应对 agent 进程树负责。

### 2.4 为什么客户端会想「每个模型开一个会话」

`buildConfigOptions()` 装配的 `thought_level` 选项**只描述当前模型**：

- `buildConfigOptions()` 里 `buildModelConfigOption(...)`（全量模型，一个 selector）与 `buildEffortConfigOption(modelInfos, currentModelId, …)`（当前模型）并列 — [`src/acp-agent.ts:13067-13104`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L13067-L13104)，effort 装配在 `:13086`；函数定义在 `session-effort.ts`。
- `buildEffortConfigOption()` 先用 `currentModelInfo = modelInfos.find(m => m.value === currentModelId)` 定位当前模型，再取 `supportsEffort` / `supportedEffortLevels`；当前模型不支持 effort 就**返回 `undefined`**（该选项整个不出现）— [`src/session-effort.ts:90-113`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/session-effort.ts#L90-L113)。
- 模型 selector 则是**一个**选项、含全部模型 — [`src/session-model.ts:188-243`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/session-model.ts#L188-L243)。
- 切模型是在**同一会话内**完成的：`session.query.setModel(...)` — [`src/acp-agent.ts:9303`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9303)，并在切换后重建 configOptions（`buildConfigOptions` 调用点 `:11090-11116`）。

**推论：** 想知道「模型 M 有哪些档位」，确实必须让会话处于 M（或问 agent 的私有 API）。但**这只需要在一个会话里依次 `set_config_option(model=M)` 再读返回的完整快照**，不需要新会话——每次 `set_config_option` / `config_option_update` 都返回**完整** configOptions（见 §3.3）。§3.4 给出该结论的协议依据。

## 3. ACP 协议规范：close 与模型元数据

**结论：** `session/close` 在 v1 是**可选**能力（schema 原文 "Optional"），客户端**必须先查能力**才可调用。`NewSessionResponse` 直接携带全量 `configOptions`（含 `model` 的全部选项、当前模型的 `thought_level`、`model_config`），因此「列全部模型」不需要开会话；「列每个模型各自档位」协议**没有**专门接口，但可在单会话内切模型读快照，**不构成「每模型一个会话」的正当理由**。

### 3.1 `session/close` 是可选的

- schema 原文：`"Whether the agent supports `session/close`. Optional. Omitted or `null` both mean the agent does not advertise support. Supplying `{}` means the agent supports closing sessions."` — [`schema/v1/schema.json:2578-2592`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/schema/v1/schema.json#L2578-L2592)；`SessionCloseCapabilities` 定义 `:2646-2660`。
- 文档要求客户端先查：**"Clients MUST verify … If `sessionCapabilities.close` is not present, the Agent does not support closing sessions and Clients MUST NOT attempt to call `session/close`."** — [`docs/protocol/v1/session-setup.mdx:274-293`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/protocol/v1/session-setup.mdx#L274-L293)。
- 语义：close 必须「当作调过 `session/cancel`」再释放资源 — 同上 `:310-314`；schema `CloseSessionRequest` 的 description 同述，并写明 "Only available if the Agent supports the `sessionCapabilities.close` capability" — [`schema/v1/schema.json:5298-5310`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/schema/v1/schema.json#L5298-L5310)。
- 稳定化时间线：RFD "2026-04-23: RFD marked as Completed; `session/close` is stabilized" — [`docs/rfds/session-close.mdx:79`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/rfds/session-close.mdx#L79)。**注意：稳定化 ≠ 变成必备**，它仍是上面那个 Optional 字段。
- RFD 的 "Status quo" 段几乎逐字描述了本次事故：*"if you start a session, it will remain active until the ACP process is terminated … active users with many sessions can end up with a lot of processes unnecessarily using up system memory"* — [`docs/rfds/session-close.mdx:18-24`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/rfds/session-close.mdx#L18-L24)。RFD 还明确 "the client would be able to close old sessions"、"Clients can track what sessions are actively used by a user and automatically close old sessions" — 即**回收是客户端职责**（`:41-46`）。

### 3.2 `NewSessionResponse` 返回什么

`NewSessionResponse` 只有三个可选主体：`sessionId`（必需）、`modes`、`configOptions` — [`schema/v1/schema.json:2856-2895`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/schema/v1/schema.json#L2856-L2895)。

- **`configOptions` 就是模型列表的载体**：`category: "model"` 的那个 select，其 `options[]` 枚举了全部可模型；`currentValue` 是当前模型。
- `SessionConfigOption` 结构为 `id` / `name` / `description` / `category` / `_meta` + `oneOf`（`select` | `boolean`）— [`schema/v1/schema.json:2964-3010`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/schema/v1/schema.json#L2964-L3010)。
- `category` 枚举含 `mode` / `model` / `model_config` / `thought_level` / 其它；且**明确只是 UX 提示**："It MUST NOT be required for correctness. Clients MUST handle missing or unknown categories gracefully." — [`schema/v1/schema.json` 的 `SessionConfigOptionCategory`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/schema/v1/schema.json)；文档同述并给 `model_config` 的语义（如 context size、speed/quality）— [`docs/protocol/v1/session-config-options.mdx:209-226`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/protocol/v1/session-config-options.mdx#L209-L226)。

### 3.3 「有没有列出所有模型及其思考档位的接口」

**没有一次性接口，但不需要新会话。**

- 协议里没有任何「按模型枚举 thought_level」的方法；`thought_level` 是**一个** select 选项，其 `options` 只属于**当前模型**。这与 §2.4 的实现一致。
- 但换模型后会返回**完整**配置快照：`session/set_config_option` 的成功响应带回完整 `configOptions`，`config_option_update` 通知也是完整列表 —— 协议文档 "Session Configuration"（[`docs/protocol/v1/session-setup.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/protocol/v1/session-setup.mdx)）与 [`docs/protocol/v1/session-config-options.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/protocol/v1/session-config-options.mdx) 的 "Default Values and Graceful Degradation" 一节；实现侧对应 `setSessionConfigOption` 返回 `{ configOptions }` — [`claude-agent-acp src/acp-agent.ts:9311`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts#L9311)。
- 所以「读 N 个模型的档位」= **1 个会话 × N 次 `set_config_option`**，而非 N 个会话。这正是 `docs/design/acp-session-lifecycle-mechanism-research-2026-10-28.md` §5 实验 B 的协议依据（4 模型仅 1 个会话读到四档位）。

### 3.4 生态探测矩阵的坑（`未确认` 一项）

`agentclientprotocol/registry` 的 `.protocol-matrix/latest.md`（commit `63e5a172cb3b48017b2dba0fd06c1050eb28e8db`，日 2026-10-27）对 claude-acp 0.97.0 报的是 `loadSession, session/list, session/fork, session/resume`，**没有 close**。但同一份 `latest.json` 里字段名是 `sessionStop: false`、探针打的是 **`session/stop`**（旧名，返回 `-32601 Method not found: "session/stop"`），根本没有探 `session/close`。

**结论：这份矩阵不能用来判断「某 agent 是否支持 close」**——它沿用 `session/stop` 旧口径（RFD 记载 2026-03-09 "Rename from session/stop to session/close"）。任何据此得出「claude-agent-acp 不支持 close」的判断都是工具的假阴性。本文对 close 的结论以 §2.2 的 agent 源码 + `initialize` 宣告为准。（同一条矩阵还把 startup stderr 里带 `sdk-initialize durationMs=1827` 的完整会话创建日志打了出来，可作 §2.1 的旁证，但仅作线索。）

## 4. 其它客户端实现

**结论：** 四份实现给出了四种不同的生命周期策略，但共同点是**都自己负责回收**，没有一份指望 agent 自觉。Zed 靠连接/进程组，MonoCode 靠 per-thread 进程组 + 退出时全量终止，acp-components 靠显式 close（**不做能力检查**，是反例），codex-acp 把 close 映射到自身 thread 的 `shutdown()`。

| 实现 | 进程 : 会话 | 并发上限 | 会话池化 | 空闲 TTL | 进程组/树回收 |
| --- | --- | --- | --- | --- | --- |
| Zed | 1 : N（per project × Agent） | 无 | 连接级复用 | **无** | `killpg`（`setsid`）+ Win Job Object |
| MonoCode | 1 : 1（per thread） | 无（`MAX_CONFIGURED_BINARY_VALIDATIONS` 是别的用途） | 无 | **无** | `process_group(0)` + `kill(-pid)`，SIGTERM→SIGKILL 升级 |
| acp-components | 由 host 注入 spawn | 无 | 无 | 无 | 无（core 不拥有 spawn） |
| codex-acp（agent 侧） | 1 : 1（thread） | 无 | 无 | 无 | 委托 `thread.shutdown()` |

### 4.1 MonoCode（`hardbeat920/monocode`）

最值得抄的 Rust 范例：**每个 thread 一个常驻 harness 子进程，但每个都自成进程组，退出时按组终止。**

- 每个子进程自成进程组 + 打 reap 标记：`isolate_child()` 里 `cmd.process_group(0)`（Unix）/ `CREATE_NEW_PROCESS_GROUP`（Windows），注释写明 "Its own process group, so one signal reaches the whole tree" — [`src-tauri/src/harness.rs:1559-1579`](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src-tauri/src/harness.rs#L1559-L1579)。
- 按组信号：`libc::kill(-ipid, sig)` **再** `libc::kill(ipid, sig)`；注释解释顺序理由——"Signal the group first; looking it up through a dead leader loses descendants that ignored SIGTERM" — [`src-tauri/src/harness.rs:1694-1712`](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src-tauri/src/harness.rs#L1694-L1712)。
- 升级策略：先 SIGTERM，等 `KILL_ESCALATE` 后若 `tree_alive` 再 SIGKILL — `terminate_after()` `:1622-1641`；批量版 `terminate_all()` `:1644-1674`（SIGTERM 全部 → `wait_until_dead(KILL_ALL_GRACE)` → SIGKILL 剩余）。
- 存活判定同时查 pid 与组：`libc::kill(ipid, 0) == 0 || libc::kill(-ipid, 0) == 0` — `:1729-1735`。
- 注册表按 session id 存 child，重复 spawn 会先摘掉旧 child：`children: HashMap<String, Arc<LiveChild>>`、`kill_session()` — `:168-166, 270-283`。
- 应用退出时全量 reap（harness + pty）：`reap_harness_children()` → `host.kill_all()` — [`src-tauri/src/lib.rs:708-722`](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src-tauri/src/lib.rs#L708-L722)。
- **它不调 `session/close`**：全仓 `src/` + `src-tauri/` 检索 `session/close` / `closeSession` → 0 命中。会话生命周期完全由「per-thread 进程 + 进程组回收」承担。

### 4.2 acp-components（`zvzuola/acp-components`）——反例

- 有显式 close 动作：`closeSession()` 调 `client.closeSession(sessionId)` 并从两个 store 移除 — [`packages/core/src/actions/sessions.ts:82-86`](https://github.com/zvzuola/acp-components/blob/1708c20274c9f15ee3a072009e5ca9fd3b71a9de/packages/core/src/actions/sessions.ts#L82-L86)；底层 `AcpClient.closeSession()` 直接发 RPC — [`packages/core/src/client/AcpClient.ts:356-360`](https://github.com/zvzuola/acp-components/blob/1708c20274c9f15ee3a072009e5ca9fd3b71a9de/packages/core/src/client/AcpClient.ts#L356-L360)。
- **但它不检查 `sessionCapabilities.close`**（同文件里对 `list` 是有检查的：`provider.ts:410`、`:499`）。对不宣告 close 的 agent，这会产生一个必然失败或不被处理的请求。
- core **刻意不拥有 spawn**：`AcpClient.ts:39-40` 注释 "core does not own a stdio spawn implementation"，因此进程树回收责任交给宿主，core 自身无任何 `detached`/`kill`/`taskkill` 代码（全仓检索 0 命中）。

> 教训：**「发 close 请求」不等于「会话被回收」**。要么像 Zed 那样先查能力再决定路径，要么像 MonoCode 那样不依赖协议、直接对进程组负责。

### 4.3 codex-acp（`zed-industries/codex-acp`，agent 侧）

- 宣告 close 能力：`SessionCapabilities::new().close(SessionCloseCapabilities::new())` — [`src/codex_agent.rs:458-461`](https://github.com/zed-industries/codex-acp/blob/296069e841634cd4bb9bc4515602d836e49231ec/src/codex_agent.rs#L458-L461)。
- `close_session()` = 取 thread → `shutdown().await` → 从 `thread_manager` / `sessions` / `session_roots` 三处移除 — [`src/codex_agent.rs:780-801`](https://github.com/zed-industries/codex-acp/blob/296069e841634cd4bb9bc4515602d836e49231ec/src/codex_agent.rs#L780-L801)。
- 这印证了 §2.2 的模式：**agent 侧的 close 只负责「自己这边的会话对象与其子进程」，不负责限流**。

## 5. 进程树回收的可靠做法

**结论：** 单 `child.kill()` 只杀直接子进程，agent 派生的 `claude` + 各自 MCP server 会成孤儿——这正是事故中「需手动递归 kill」的原因。可靠做法是**spawn 时就让子进程成为新进程组/会话的组长**，回收时对**组**发信号；Windows 上改用 Job Object 或 `taskkill /T /F`。

### 5.1 Node.js：`detached: true` + `process.kill(-pid)`

- `detached` 的语义（官方文档原文）：非 Windows 平台上，`detached: true` 会让子进程成为**新进程组和新 session 的 leader** — [`node/doc/api/child_process.md:923-937`](https://github.com/nodejs/node/blob/79c1fc4fbb2c30c07b0d3f2bef90445d26c9e1b2/doc/api/child_process.md#L923-L937)。
- 负数 pid 即「向整个进程组发信号」（POSIX `kill(2)` 语义；Node 文档未复述负数语义，只写 "it is really just a signal sender, like the `kill` system call" — [`node/doc/api/process.md:2701-2706`](https://github.com/nodejs/node/blob/79c1fc4fbb2c30c07b0d3f2bef90445d26c9e1b2/doc/api/process.md#L2701-L2706)，并注明 "Windows platforms will throw an error if the `pid` is used to kill a process group" `:2703-2704`）。
- **真实库实现（execa，`killDescendants`）**：spawn 时强制 `detached: true`，杀时 `process.kill(-subprocess.pid, signal)`，失败回落到 `subprocess.kill(signal)` — [`execa/lib/terminate/kill-descendants.js:12-14`](https://github.com/sindresorhus/execa/blob/247faa0ff0641020e8790475989cee72df85d62b/lib/terminate/kill-descendants.js#L12-L14) 与 `:45-57`。Windows 分支用 `taskkill /pid <pid> /T /F` — `:64-81`。
- execa 文档同时点明**边界**：子孙若自己 `setsid()` 就逃逸；组内全退出后 pid 可能被复用，"calling `subprocess.kill()` at that point might, in rare cases, signal an unrelated process group" — [`execa/docs/termination.md:209-214`](https://github.com/sindresorhus/execa/blob/247faa0ff0641020e8790475989cee72df85d62b/docs/termination.md#L209-L214)。

**最小可靠写法（Unix）：**

```js
const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
// 回收：整组
try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
// 升级
setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 3000).unref()
```

> 注意：`detached: true` 只影响进程组归属；若还想让父进程不等子进程，需要额外 `child.unref()`（文档 `:939-944`）。对 ACP 这种「父进程必须持有管道」的场景**不要** `unref()`，只取进程组语义。

**`tree-kill` 类库是另一条路线**（枚举父子关系逐个杀）：`node-tree-kill` 在 darwin 用 `pgrep -P`、Linux 用 `ps --ppid` 递归建树后逐个 `kill`，Windows 用 `taskkill /T /F` — [`node-tree-kill/index.js:25-51`](https://github.com/pkrumins/node-tree-kill/blob/cb478381547107f5c53362668533f634beff7e6e/index.js#L25-L51)（该 commit 为本文检出 HEAD，非 release tag，`未确认`）。

> 两相对比：**按组信号（§5.1）优于枚举树**——它不需要在杀之前抢占时间窗枚举子进程（枚举期间新派生的进程会漏），且对「组长已退出」的组依然有效（PGID 只要还有成员存活就保留）。§5.2 的 Zed / §4.1 的 MonoCode 都选了按组。

### 5.2 Zed 的做法（Rust）：`setsid` + `killpg`

- spawn 前统一 `pre_exec(setsid)`，让子进程成为新 session leader：`set_pre_exec_to_start_new_session()` — [`crates/util/src/util.rs:430-446`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/util/src/util.rs#L430-L446)，由 `Child::spawn` 无条件调用 — [`crates/util/src/process.rs:39`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/util/src/process.rs#L39)。
- 杀时 `libc::killpg(pid, SIGKILL)` — 同文件 `:113-119`。因为 `setsid` 后子进程是新 process group leader（PGID == PID），`killpg(pid)` 正好命中整棵由它派生的进程树。
- Windows 用 Job Object，并在注释里诚实交代了残留竞态："descendants the child spawns between the `spawn()` call returning and the assignment below escape the job"、以及为什么不解（需要 `CREATE_SUSPENDED`，std/smol 不支持）— [`crates/util/src/process.rs:75-90`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/util/src/process.rs#L75-L90)。

### 5.3 对本仓库的直接含义（只陈述事实，不含改动建议）

- `src/host/service/acp-agent.ts:609-616` 的 `spawn(...)` **没有** `detached`，因此子进程与 DSH 同组。
- `src/host/service/acp-agent.ts:571,660,674` 的回收是 `live.child.kill('SIGTERM'/'SIGKILL')`，**单 pid**。
- 二者相加的后果：agent 派生的孙进程（`claude` 及其 MCP server）不在任何一次 `kill` 的射程内；若父进程被 `SIGKILL`（无机会执行任何 `kill`），整棵树都留下。
- 旁证：`claude-agent-acp` 自己在 `index.ts:98-100` 专门写了「stdin EOF → 退出」来对抗 "orphan process accumulation"，说明孤儿进程是该生态的已知问题；但那是**agent 自保**，不能替代客户端的进程组回收。

## 参考源码（固定 commit）

**协议 / 规范**
- [`schema/v1/schema.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/schema/v1/schema.json) — `close` 可选（:2578-2592）、`SessionCloseCapabilities`（:2646-2660）、`NewSessionResponse`（:2856-2895）、`SessionConfigOption`（:2964-3010）、`CloseSessionRequest`（:5298-5310）
- [`docs/protocol/v1/session-setup.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/protocol/v1/session-setup.mdx) — 关闭会话（:270-314）
- [`docs/protocol/v1/session-config-options.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/protocol/v1/session-config-options.mdx) — category 语义（:209-226）
- [`docs/rfds/session-close.mdx`](https://github.com/agentclientprotocol/agent-client-protocol/blob/aa3cca0f36818591a57ed313db34b7e6a1142b49/docs/rfds/session-close.mdx) — status quo（:18-24）、2026-04-23 稳定化（:79）
- [`registry/.protocol-matrix/latest.json`](https://github.com/agentclientprotocol/registry/blob/63e5a172cb3b48017b2dba0fd06c1050eb28e8db/.protocol-matrix/latest.json) — 旧 `session/stop` 口径（§3.4 的坑）

**claude-agent-acp**
- [`src/acp-agent.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts) — `newSession`（:3079）、能力宣告 `close: {}`（:2993-3001）、`closeSession`/`teardownSession`/`dispose`（:9118-9202）、`query()` spawn（:11961-11969）、session 注册（:12202）、`buildConfigOptions`（:13067-13104）、`setModel`（:9303）
- [`src/session-effort.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/session-effort.ts) — `buildEffortConfigOption`（:90-113，只覆盖当前模型）
- [`src/session-model.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/session-model.ts) — `buildModelConfigOption`（:188-243，单一 selector 含全模型）
- [`src/index.ts`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/index.ts) — stdin EOF / 信号 → `dispose`（:90-106）
- [`CHANGELOG.md`](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/CHANGELOG.md) — "Add session/close support (#409)"（:1168，0.22.0 节）

**Zed**
- [`crates/agent_ui/src/agent_connection_store.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/agent_connection_store.rs) — per-Agent 连接缓存（:89）、`request_connection` 复用（:186-194）、`shutdown_connections`（:115-125）
- [`crates/agent_ui/src/conversation_view.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/conversation_view.rs) — `close_all_sessions` 先查能力（:1024-1049）、`release_sessions`（:1052-1058）、`on_release` 触发（:1106-1112）、每 thread 开 session（:1438-1443）
- [`crates/acp_thread/src/connection.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/acp_thread/src/connection.rs) — trait 默认 `supports_close_session=false`（:133-136）、`should_close_sessions_on_release`（:144-149）、默认 `shutdown()` 空实现（:107）
- [`crates/agent_servers/src/acp/v1.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v1.rs) — `close_session_and_drain`（:55-73）、`AcpConnection::stdio` spawn（:540-557）、能力检查（:907-909）、注册失败即 close（:1335-1352）
- [`crates/agent_servers/src/acp/v2.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/v2.rs) — `supports_close_session`（:1451-1453）、`shutdown` drop runtime（:1258-1261）、`should_close_sessions_on_release=false`（:1598-1601）
- [`crates/agent_servers/src/acp/transport.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_servers/src/acp/transport.rs) — `OwnedChild` + Drop kill（:14-20）、`spawn_stdio`（:31-80）
- [`crates/util/src/process.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/util/src/process.rs) — `setsid` pre_exec（:39）、`killpg`（:113-119）、Win Job Object 注释（:75-90）
- [`crates/util/src/util.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/util/src/util.rs) — `set_pre_exec_to_start_new_session`（:430-446）

**其它实现 / 库**
- [monoCode `src-tauri/src/harness.rs`](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src-tauri/src/harness.rs) — `isolate_child` `process_group(0)`（:1559-1579）、`terminate_after`（:1622-1641）、`terminate_all`（:1644-1674）、`signal_tree` `kill(-ipid)`（:1694-1712）、`tree_alive`（:1729-1735）
- [monoCode `src-tauri/src/lib.rs`](https://github.com/hardbeat920/monocode/blob/26465c620977f3951d0a532a0f7db32c3c179007/src-tauri/src/lib.rs) — 退出时 `reap_harness_children`（:708-722）
- [acp-components `packages/core/src/actions/sessions.ts`](https://github.com/zvzuola/acp-components/blob/1708c20274c9f15ee3a072009e5ca9fd3b71a9de/packages/core/src/actions/sessions.ts) — `closeSession`（:82-86）
- [acp-components `packages/core/src/client/AcpClient.ts`](https://github.com/zvzuola/acp-components/blob/1708c20274c9f15ee3a072009e5ca9fd3b71a9de/packages/core/src/client/AcpClient.ts) — `closeSession` RPC（:356-360）、core 不拥有 spawn（:39-40）
- [codex-acp `src/codex_agent.rs`](https://github.com/zed-industries/codex-acp/blob/296069e841634cd4bb9bc4515602d836e49231ec/src/codex_agent.rs) — close 能力（:458-461）、`close_session`（:780-801）
- [execa `lib/terminate/kill-descendants.js`](https://github.com/sindresorhus/execa/blob/247faa0ff0641020e8790475989cee72df85d62b/lib/terminate/kill-descendants.js) — `detached:true` + `kill(-pid)`（:12-14, :45-57）、Windows taskkill（:64-81）
- [execa `docs/termination.md`](https://github.com/sindresorhus/execa/blob/247faa0ff0641020e8790475989cee72df85d62b/docs/termination.md) — 边界与限制（:209-214）
- [node `doc/api/child_process.md`](https://github.com/nodejs/node/blob/79c1fc4fbb2c30c07b0d3f2bef90445d26c9e1b2/doc/api/child_process.md) — `options.detached`（:923-937）
- [node `doc/api/process.md`](https://github.com/nodejs/node/blob/79c1fc4fbb2c30c07b0d3f2bef90445d26c9e1b2/doc/api/process.md) — `process.kill(pid, signal)`（:2685-2706）
- [node-tree-kill `index.js`](https://github.com/pkrumins/node-tree-kill/blob/cb478381547107f5c53362668533f634beff7e6e/index.js) — 枚举式 tree kill（:25-51）

## 未确认项

1. **`query.close()` 是否连带杀掉 `claude` 的孙进程（MCP server）**。`claude-agent-acp` 只调用 SDK 的 `query.close()`；`@anthropic-ai/claude-agent-sdk` 内部如何 spawn/回收 CLI 本文未逐行确认。
2. **PR #409 与本文 commit 之间是否存在后续 revert**。仅核对了 CHANGELOG 与 PR 元数据，未逐 commit 追溯（当前源码确实带 `close: {}`，故实际影响为零）。
3. **Zed 是否存在本文检索路径之外的 idle 驱逐**（例如 `agent_panel` 的 thread 持久化层）。检索范围为 `crates/agent_ui`、`crates/agent_servers`、`crates/acp_thread`，三条 crate 内 `idle_timeout`/`IDLE_TTL`/`evict` 均 0 命中。
4. **`node-tree-kill` 的检出 commit 不是 release tag**，其行号会随 `main` 漂移。
