<!-- DSH-IDEMPOTENCY-KEY: deck-afbdcbf8-5977070 -->
<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: bug -->
# 01: 进程膨胀：单适配器派生 65（第二波 193）个外部 agent 进程，MCP 乘法放大打满 18GB

Labels: bug

**Status:** resolved

## 实际

**第一波**：单个 ACP 适配器实例在同一秒内派生 **65 个** `claude-code-acp` 外部 agent 进程。65 个 session-id 全新且互异，磁盘无对应会话文件；全部 S 态空转，累计 CPU 各约 5s，父进程仅 2.45s，**持续 10 分钟无回收**。

**第二波（kill 后重启适配器）更大**：claude-code-acp **193** / codex-acp **149** / agy **19**。

**MCP 乘法放大**：`forwardMcp` 默认 `true`，10 个 MCP server 经 `session/new` 透传给每个会话；实测 filesystem 32 / memory 30 / sequential-thinking 22 / context-mode 21。**进程数 = 会话数 × MCP 数。**

**后果**：18GB 打满（压缩 7GB + swap 14.5GB），load 23.4，整机卡死；只能手动 `kill -9` 整棵树恢复。

**环境**：DSH 0.2.1-rc.3 / dsh-acp-pro 0.1.0 / claude-code-acp 0.16.1 / codex-acp 2.2.2 / claude 2.1.310 / node v20.20.2 / macOS 27.0.1 / M3 Pro 18GB。

## 期望

1. 单适配器不应在同一秒并发派生 N 个 agent 进程；所有路径都要有并发上限。
2. **MCP 不应按会话复制**：10 × N 是乘法放大，必须解耦。
3. 会话级 idle 回收（`idleTimeoutMs` 只覆盖单回合流式超时）。
4. 退出/dispose 时 `killpg` 回收整棵进程树。

## 复现步骤

第一波：**冷启动即触发**，无需任何交互。

1. 前置条件如上述环境。
2. 退出 DSH，确认无残留：`pgrep -f 'claude-code-acp|codex-acp' | wc -l`（期望 0）。
3. 冷启动 DSH，**不做任何交互**。
4. 观测：
   ```sh
   p=$(pgrep -f claude-code-acp | head -1)
   ps -p "$p" -o pid,etime,stat,time
   pgrep -P "$p" | wc -l
   pgrep -f 'server-filesystem|server-memory' | wc -l
   ```
5. 验证是否满足 `会话数 × 每会话 MCP 数`。
6. kill 后重启，观察第二波规模。

## 【已闭合】两个未确认点（本轮结论）

### 闭合 1：`query.close()` **不会**清理 MCP 孙进程 —— 升级包救不了 MCP 泄漏

`一手源码`（claude-agent-sdk 0.3.312 实际产物，非文档）逐层确认：

| 层 | 事实 |
| --- | --- |
| `ProcessTransport.spawnLocalProcess` | `spawn(..., { stdio, signal, env, windowsHide:true })` —— **没有 `detached`**，子进程不独立成组 |
| `ProcessTransport.close()` | `processStdin.end()` → 再对直接子进程 `h.kill("SIGTERM")`，5s 后 `k.kill("SIGKILL")` —— **全部是单 pid** |
| `Query.cleanup()` → `transport.close()` | 同上，无进程组信号 |
| claude-agent-acp `teardownSession` | `closeQueryStream` → `query.close()`，注释称 "already torn the subprocess down" —— 只保证 **claude 主进程** |

`本机实测`（独立复现，用 `process.kill(pid,0)` 探测，**不用 `ps`**）：

```
BEFORE:            mcp pid=88528 alive=true
AFTER parent SIGKILL: mcp pid=88528 alive=true   ← 孤儿存活
```

**结论**：父进程死掉后 MCP 孙进程**继续存活**。因为 SDK 只 kill 直接子进程且未 `setsid`，MCP 由 claude 拉起、位于更下一层，**任何单 pid kill 都收不到它**。

> ⚠️ **这直接限定了「升级包」的效力**：新版 agent 支持 `session/close` 后，close 能回收 **claude 主进程**，但**它拉起的 MCP 孙进程仍会残留**。所以「升级缓解」只能缓解一半——**进程树回收必须在客户端用 `killpg` 兜底**。
>
> 一个诚实的插曲：我最初用 `ps -p` 判断存活，两次都显示 "gone"，差点得出「孙进程会自己退出」的错误结论。查明是**沙箱拒绝执行 `ps`**（`/bin/ps: Operation not permitted`）——假阴性。改用 `process.kill(pid, 0)` 才测出真相。**检测工具本身不可信时，结论必须重测。**

### 闭合 2：fan-out 主因是 **ephemeral 路径**，不是 `getSessionSnapshots`

**我此前两个归因都错了，此处更正：**

- ❌ 「`getSessionSnapshots` 批量实体化」：它的 `providers` 是 **`profiles().keys()` ∪ 本 dshSessionId 的 binding provider**，上限 = **route 数（3）**，不可能产生 65。且它只由当前会话面板**每秒轮询**触发（`session-control-panel.tsx:127`，有 `requestInFlight` 防重入）。**排除。**
- ✅ **`ephemeral` 路径**（`acp-adapter.ts:899`）：

```ts
const ephemeral = dshSessionId === undefined || purpose !== undefined
const release = ephemeral ? undefined : await this.coordinator.acquire(key)
// :962  →
if (ephemeral) {
  binding = this.createBinding(route, undefined, profile, options.model)  // 每次新建，不查 store、不复用
}
```

**三个致命特性**：① **无 coordinator 锁**（不串行化）；② **每次 `createBinding`**（无复用、无去重）；③ 走 `ensureSession` → **透传全部 MCP**。完全匹配现场「65 个互异 session-id + 全套 MCP + 不回收」。

**哪些宿主行为会走这条路**（`一手源码`，均带 `purpose`）：
- `purpose: 'compaction'` —— 压缩摘要（`compaction-basic/src/summarizer.ts:160`）
- `purpose: 'session-title'` —— 生成标题（`session-title-llm/src/index.ts:264`）
- 任何 `sessionId === undefined` 的调用

`本机实测`量化：

| 并发 purpose 调用 | 会话数 | 每会话 MCP | 推算总进程 |
| --- | --- | --- | --- |
| 8 | **8** | **10** | **8 × 11 = 88** |

**这与现场 65/193 同一量级**——线性 1:1，乘 MCP 放大。**「冷启动零交互」也吻合**：标题生成与压缩在启动/会话初始化时自动发生。

> 一个副作用：因为 ephemeral 不写 `bindingStore`，这**同时解释了「磁盘上找不到对应会话文件」**——现场 65 个 session-id 全部无落盘，正是 ephemeral 的签名。这是比 MCP 计数更强的证据。

## 缺陷表（终版）

| # | 缺陷 | 证据强度 |
| --- | --- | --- |
| A | **放大**：`ephemeral` 路径无锁 + 每次新建 binding + 无不复用 → N 并发 = N 会话 | 源码 + 实测 |
| B | **无主**：临时会话无租约/TTL，`idleTimeoutMs` 只管回合内 | 源码 |
| C | **无回收**：SDK 只 kill 直接子进程、无 `detached`；MCP 孙进程实测存活 | 源码 + 实测 |
| D | **MCP 乘法**：`进程数 = 会话数 × MCP 数` | 实测 8×10 |

## 责任边界（已验证）

- DSH ACP **服务端**做对了：名册走 `listModels`（`:160`，零会话）、只解析当前模型（`:196-199`）、并发过 `serialize()`（`:136-141`）。
- 问题在 **adapter 把「一次解析」实现成「一个会话」**，且 ephemeral 路径连锁都没有。**修在 adapter，`catalog.ts` 零改动。**

## 业界判定：「每模型开会话」是反模式

四实现（OpenRouter / Anthropic / VS Code Agent Host / Zed）**无一**为「列模型档位」创建 per-model 执行体。claude-agent-acp 的 `modelInfos` 来自**一次** `initializationResult()` —— agent 单进程内已含全部档位，开 N 个会话是纯浪费。

**单会话方案可行且降级安全**：规范要求 `set_config_option` 必返完整配置并点名「换模型影响 reasoning 选项」；claude-agent-acp 切模型即重建（`:11056`）；codex-acp 同形；gemini-cli 不发 configOptions → 读不到 `undefined`，不报错。**前提**：探测是写操作，必须用**专用探测会话**（本插件 `applyConfigOptions:118-137` 与 `selectModel:318-337` 零件已齐）。

## 关于 close 的前提（已收紧）

`@zed-industries/claude-code-acp` 止于 **0.16.2** 且已 deprecate 改名为 `@agentclientprotocol/claude-agent-acp`；后续身份 **0.22.0（2026-03-16）** 起支持 close，当前 0.97.0 在 `acp-agent.ts:2995` 宣告 `close: {}`。但：**该 agent 至今无会话数上限/空闲超时**，且 **close 不清理 MCP 孙进程**（见闭合 1）。**升级是缓解，不是修复。**

> 避坑：`agentclientprotocol/registry` 能力矩阵探的是旧名 `session/stop`，从未探 `session/close`，据此判断是假阴性。

## 开源对照：Zed 的结构性差别

- `AgentConnectionStore` 以 `HashMap<Agent,…>` 缓存连接（`agent_connection_store.rs:89`）——**进程绑连接、会话绑 thread**，进程数 ≈ agent 数。
- `session/close` 走能力协商，拿不到就静默跳过（`conversation_view.rs:1024-1026` 直接 `Ok(())`）。
- **无 idle TTL**（三 crate 检索 0 命中）——靠结构而非超时。**反证 TTL 不是首要解。**
- 进程树回收：spawn 时 `setsid`，Drop 时 `libc::killpg(SIGKILL)`（`util/process.rs:39,113-119`）。

## 仓内代码事实

1. **ephemeral 判定与无锁**：`acp-adapter.ts:899-901`；**每次新建 binding**：`:962`。
2. **`ensureSession` 默认透传全部 MCP**：`acp-adapter.ts:827`；`acp-agent.ts:228`。
3. **`forwardMcp` 默认 true**：`config/schema.ts:40`。
4. **探测路径不转发 MCP**：`acp-agent.ts:502,519` 显式 `[]`。
5. **探测无单飞**：`acp-agent.ts:512-536`（对比 `:502` 有）。
6. **快照仅面板轮询**：`session-control-panel.tsx:127`（1s interval）。
7. **关闭路径缺失**：`acp-agent.ts:487-495`。
8. **回收不落进程树**：`acp-agent.ts:571` 只 `child.kill()`；spawn（`:609-616`）无 `detached`。
9. **`idleTimeoutMs` 只管回合**：`acp-adapter.ts:1104-1114`。

## 修复方向（按收益排序）

1. **ephemeral 路径加锁 + 限流（新晋最高收益）**：至少给 ephemeral 加并发信号量；或复用同一临时会话串行完成（标题/压缩本就是短任务）。
2. **MCP 按需/共享**：MCP 不按会话复制——把乘法打回加法。
3. **`killpg` 回收（已由闭合 1 升为必做）**：`detached: true` + `process.kill(-pid)`，因为 **agent 侧 close 清不掉 MCP 孙进程**。
4. **探测单飞 + 单会话循环**：套用已有 `discovering ??=`；1 专用会话 + N 次 `set_config_option`。
5. **会话租约 + TTL**：兜底（Zed 无 TTL 也不出事，故非根治）。
6. **升级包名**：缓解「永不回收」，**不解决峰值、不解决 MCP 残留**。

## 参考资料

**仓内笔记**
- [`docs/design/acp-lifecycle-oss-research-2026-10-28.md`](../../docs/design/acp-lifecycle-oss-research-2026-10-28.md)（调研笔记已于 2026-10-28 归档清理时删除） —— 生命周期：Zed / agent 侧 / killpg（270 行，83 条固定 commit 链接）
- [`docs/design/acp-model-metadata-oss-research-2026-10-28.md`](../../docs/design/acp-model-metadata-oss-research-2026-10-28.md)（调研笔记已于 2026-10-28 归档清理时删除） —— 元数据「惰性 vs 立即」+ DSH 服务端对照（327 行）
- [`docs/design/acp-session-lifecycle-mechanism-research-2026-10-28.md`](../../docs/design/acp-session-lifecycle-mechanism-research-2026-10-28.md)（调研笔记已于 2026-10-28 归档清理时删除） —— 机制判定与规范原文

**一手外部资料**
- [Session Config Options（v1）](https://agentclientprotocol.com/protocol/v1/session-config-options.md)
- [session/close RFD](https://agentclientprotocol.com/rfds/session-close.md)
- [v2 Required Session Methods](https://agentclientprotocol.com/rfds/v2/required-session-methods.md)
- [claude-agent-acp @059d76e1](https://github.com/agentclientprotocol/claude-agent-acp/blob/059d76e14a20e533846954c64ac5adcda2cf5d80/src/acp-agent.ts)
- [zed @37faef81 `agent_connection_store.rs`](https://github.com/zed-industries/zed/blob/37faef81f74fc1bb08be9939c4cffc8ede6ced2f/crates/agent_ui/src/agent_connection_store.rs#L89)

## 查重记录

- 扫描：`deck_issue_list(open, bug)` → 0；`deck_issue_list(closed, bug)` → 0；全量 `state=all` → 8 张（1 map + 7 wayfinder 子票），均无关；工具未提示清单不全。
- 命中：无。
- 报告人确认：0 命中，无候选可确认。
- 结论：新建（非回归、无关联旧单）。

## 仍待补充（needs-info，仅剩报告人侧数据）

1. **是否必现**：每次冷启动都炸，还是偶发？
2. 第二波 193/149/19 是否稳定？——**机制已不再依赖 binding 数解释**（ephemeral 不写 store），故此项降级为「确认稳定性」而非根因。

> 本机无 `data/dsh-acp-pro` binding 目录，因此「第二波与 binding 数成正比」**无法在本机验证，已从根因中移除**，不再作为结论。

## Comments

### local — 2026-10-28T02:37:29.716Z

### local — 2026-10-28T05:18:20.603Z

### local — 2026-10-28T05:18:33.359Z
已修复并验证：提交 74a3940 修掉四处独立成因（探测扇出、discoverModels 会话泄漏、快照读取实体化、进程树残留）。实测 claude 会话 33→1、MCP 进程 254→48；未使用的 agy route 从 2 个泄漏会话降到 1，是关键判据。门禁 tsc 0 / 142 测试全绿，新增 6 个针对性测试且均做过回退对照。剩余「每 route 一套 MCP」属 ACP 协议结构性成本（mcpServers 按 session 传），非泄漏，已记录不在本单范围。
## 已修复（提交 `74a3940`）

**四个独立成因**，每个都先写失败测试、确认修复前红灯再改代码：

| # | 成因 | 修法 |
| --- | --- | --- |
| 1 | 模型目录为**每个模型**各开一个探测会话，且无 in-flight 合流（诊断实测 143 次/启动） | 全部模型共用 1 个探测会话，按队列串行切模型读档位；取消时驱逐已注定失败的 inflight |
| 2 | `discoverModels` 每次探测新建会话后靠 `session/close` 释放，而 close 在 ACP v1 是**可选**能力——对不实现它的 agent 该调用是空操作，会话连同 MCP 一起残留 | 复用同一探测会话，不再新建 |
| 3 | 会话面板**每秒轮询**的 `getSessionSnapshots` 会为未实体化的 binding 建会话，且默认透传全部 MCP（**这是「没用 ACP 却在加载」的直接原因**） | 改为纯读取，仅在 agent 支持 `loadSession` 时重放已记录会话 |
| 4 | `spawn` 未 `detached`，teardown 只 kill 直接子进程，agent 拉起的 MCP 成孤儿 | 自成进程组 + `process.kill(-pid)` 收整棵树 |

### 实测效果

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| claude 会话 | **33** | **1** |
| MCP 进程 | **254** | **48** |
| 未使用过的 `agy` 会话 | 2（泄漏） | **1** |

`agy` 从 2 降到 1 是关键判据：该 route 用户从未使用，说明泄漏已止。

### 验证

- `tsc --noEmit` 0；`vitest run` **23 文件 / 142 测试**全绿
- 新增 6 个针对性测试：`process-tree` / `ephemeral-serialization` / `ephemeral-mcp` / `effort-probe-fanout` / `snapshot-materialization` / `model-discovery-reuse`
- 两处做了**回退对照**（临时还原修复，确认断言确实变红），排除恒真测试

### 明确未解决（不在本单范围，已记录）

1. **「每 route 一套 MCP」的结构性成本**：ACP 的 `mcpServers` 按 session 传，跨会话共享 MCP 进程协议层做不到。当前每 route 探测会话仍各带一套 MCP（实测共 48 个进程），这**不是泄漏**。
2. **长期内存稳定性未验证**：验收只到「会话数与进程数」这一层，内存是否长时间不被打满需要更长观察窗。

### 调研与计划

- `docs/design/acp-lifecycle-oss-research-2026-10-28.md`（Zed / claude-agent-acp / execa / monoCode 一手源码）
- `docs/design/acp-model-metadata-oss-research-2026-10-28.md`（惰性 vs 立即解析、DSH 服务端对照）
- `docs/design/acp-session-lifecycle-mechanism-research-2026-10-28.md`（机制判定，含三轮修订）
- `docs/design/acp-process-bloat-fix-plan-2026-10-28.md`（修复计划，T1–T4 已完成）
## 实施进展（2026-10-28）

**T1–T4 已实施并验证**，计划见 [`docs/design/acp-process-bloat-fix-plan-2026-10-28.md`](../../../docs/design/acp-process-bloat-fix-plan-2026-10-28.md)（调研笔记已于 2026-10-28 归档清理时删除）。

| 单 | 项 | 改动 | 新测试 |
| --- | --- | --- | --- |
| T1 | 进程树回收 | `acp-agent.ts:660` spawn 加 `detached: process.platform !== 'win32'`；新增 `killTree()`（`:600`）走 `process.kill(-pid)`，替换 `:585/705/718` 三处单 pid kill | `tests/process-tree.test.ts` |
| T2 | ephemeral 串行化 | `acp-adapter.ts:923` ephemeral 也走 `coordinator.acquire`，锁键 `ephemeralKeyOf(route)`（`:97`，`\0` 命名空间不与真实会话冲突） | `tests/ephemeral-serialization.test.ts` |
| T3 | 探测单飞 | `acp-agent.ts:187` 新增 `discoveringEfforts`；`:525` 同 key 并发合流，`restart`/`dispose` 清理 | `tests/effort-probe-fanout.test.ts` |
| T4 | ephemeral 不传 MCP | `ensureSession` 增 `mcpServers` 参数（`:760`），ephemeral 传 `[]`；真实会话仍传全部 | `tests/ephemeral-mcp.test.ts` |

**验证方式**：每项先写失败测试、确认修复前确实红，再改代码。

- T1：修复前孙进程 `alive=true`（孤儿），修复后 `false`
- T2：修复前 5 并发 → 峰值 5 个并发会话（同一毫秒内 live 1→5）；修复后峰值恒为 1。**额外做了回退对照**，确认该断言有鉴别力
- T3：修复前 5 并发探测 → 5 会话；修复后 ≤1
- T4：修复前 ephemeral 透传 3 个 MCP；修复后 0，且真实会话仍为 3（反向断言）

**门禁**：`node node_modules/typescript/bin/tsc --noEmit` 0；`node node_modules/vitest/vitest.mjs run` 20 文件 / 136 测试全绿。

**未做**：T5（会话租约 TTL）、T6（升级说明/文档）。这两项是兜底与文档，不阻塞峰值修复。

**真机已验证**（2026-10-28，报告人机器）：冷启动零交互后 claude 会话 33 → 1、MCP 进程 254 → 48；从未使用过的 `agy` route 从 2 个泄漏会话降到 1（关键判据）。
**仍待观察**：长时间运行的内存稳定性——验收只覆盖会话数与进程数，不是长稳性。

## 进度

**Blocked by:** None (can start immediately)
