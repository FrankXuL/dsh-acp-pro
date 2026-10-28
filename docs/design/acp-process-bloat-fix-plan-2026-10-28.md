# bug #01 修复计划：ACP 进程膨胀（65 / 193 进程）

> 依据：票 [#01](../../.scratch/acp-session-lifecycle/issues/01-claude-code-acp-单次运行-fan-out-65-个-idle-会.md) 的三轮诊断 + 三份一手调研。
> 状态：**T1–T4 已实施并验证**（2026-10-28）；T5（TTL）、T6（文档/升级）未做。
> 目标仓库：本仓库 `dsh-acp-pro`（**不要求宿主 `deepseek-harness` 改动**）。

## 实施进度

| 单 | 项 | 状态 | 验证 |
| --- | --- | --- | --- |
| T1 | P2 进程树回收（`detached` + `killTree`） | **已完成** | `tests/process-tree.test.ts` |
| T2 | P1 ephemeral 串行化 | **已完成** | `tests/ephemeral-serialization.test.ts` |
| T3 | P4 探测单飞 | **已完成** | `tests/effort-probe-fanout.test.ts` |
| T4 | P3 最小版：ephemeral 不传 MCP | **已完成** | `tests/ephemeral-mcp.test.ts`（含真实会话仍传 MCP 的反向断言） |
| T5 | P5 会话租约 TTL | 未做 | — |
| T6 | P6 升级说明/文档 | 未做 | — |

门禁：`tsc --noEmit` 0，`vitest run` 20 文件 / 136 测试全绿。

**每项都是先写失败测试、确认它在修复前确实红，再改代码。** T2 额外做了对照验证：临时回退修复后同一毫秒内并发会话数从 1 涨到 5，恢复后峰值恒为 1 —— 证明该测试有鉴别力，不是恒真断言。

## 0. 一句话

扇出的直接原因是 **`ephemeral` 路径（`purpose !== undefined` 或无 `sessionId`）既无串行化、又每次新建会话、还默认透传全部 MCP**；放大倍数是 **会话数 × MCP 数**；回收失败是因为 **agent 侧连 close 都不支持（现场版本），且即便支持也清不掉 MCP 孙进程**。

## 1. 已确认的事实（本计划的前提）

| # | 事实 | 证据 |
| --- | --- | --- |
| 1 | `ephemeral = sessionId === undefined \|\| purpose !== undefined`，走 `createBinding` 不复用、**不 `coordinator.acquire`** | `acp-adapter.ts:899-901,962-963` |
| 2 | 该路径 `ensureSession` → `newSession(cwd, signal)` **省略第三参 → 透传全部 MCP** | `acp-adapter.ts:827`, `acp-agent.ts:228` |
| 3 | 8 并发 purpose 调用 → **8 会话 × 10 MCP = 88 进程** | 本机实测 |
| 4 | ephemeral **不写 `bindingStore`** → 磁盘无会话文件（现场现象吻合） | 源码 |
| 5 | 触发源：`purpose:'compaction'`、`purpose:'session-title'`、无 sessionId | 宿主 `summarizer.ts:160`、`session-title-llm/src/index.ts:264` |
| 6 | ephemeral 结束时**已经调用** `agent.closeSession(session)`；对现场版本无效（不宣告 close） | `acp-adapter.ts:1214-1215`, `dsh-verification-results.md:33` |
| 7 | SDK 的 `spawn` **无 `detached`**，`ProcessTransport.close()` 只对**直接子进程**单 pid `SIGTERM`/`SIGKILL` | claude-agent-sdk 0.3.312 产物 |
| 8 | 父进程死后 **MCP 孙进程存活**（`process.kill(pid,0)` 实测 `alive=true`） | 本机实测 |
| 9 | `SessionCoordinator.acquire(key)` 是**现成的按 key 串行化**原语 | `session-coordinator.ts:5-17` |
| 10 | `idleTimeoutMs` 只覆盖**回合内**流式超时，不回收常驻会话 | `acp-adapter.ts:1104-1114` |

## 2. 修复项总览

| 项 | 内容 | 收益 | 风险 | 依赖 |
| --- | --- | --- | --- | --- |
| **P1** | ephemeral 串行化 + 复用单一临时会话 | 直接消灭 65/193 峰值 | 中（改变并发语义） | 无 |
| **P2** | `detached` + `killpg` 整树回收 | 清理现有泄漏、兜底所有路径 | 低 | 无 |
| **P3** | MCP 不按会话复制 | 把 10 倍乘法打回加法 | 中高（协议语义） | 需先确认 agent 侧行为 |
| **P4** | 探测路径单飞 + 单会话循环 | 消除探测扇出 | 低 | 无 |
| **P5** | 会话租约 TTL | 兜底残留 | 低 | P2 之后 |
| **P6** | 升级 agent 包名 | 让 close 生效（仅主进程） | 低 | 用户侧配置 |

**建议实施顺序：P2 → P1 → P4 → P5 → P3 → P6。**
理由：P2 最先做——它**立刻停止继续泄漏**、风险最低、且是 P1 之后仍必需的兜底；P1 是峰值主因；P3 收益大但涉及协议语义，放后。

## 3. P2：进程树回收（先做，最低风险）

### 改动

**`src/host/service/acp-agent.ts:609`** — spawn 增加 `detached`（非 Windows 才有效）：

```ts
const child = spawn(profile.command, profile.args, {
  cwd: profile.cwd ?? homedir(),
  env: { ...process.env, ...profile.env },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  shell: process.platform === 'win32',
  // NEW: 自成进程组，使我们能按组回收孙进程（MCP）
  detached: process.platform !== 'win32',
})
```

**新增私有方法**，统一替换 `:571`、`:660`、`:674` 三处 `child.kill(...)`：

```ts
/**
 * Kill the agent and everything it spawned (MCP servers live one level below).
 * POSIX: the child leads its own process group (`detached`), so a negative pid
 * signals the whole tree. Windows has no group signal here — fall back to a
 * direct kill, which is the pre-existing behavior.
 */
private killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)   // 负 pid = 整个进程组
      return
    }
    catch {
      // 进程组已消失（或 detached 未生效）：退回单 pid
    }
  }
  child.kill(signal)
}
```

三处调用替换：
- `teardown()` 内 `live.child.kill('SIGTERM')` → `this.killTree(live.child, 'SIGTERM')`
- 两处 `initialize`/`authenticate` 失败的 `child.kill('SIGKILL')` → `this.killTree(child, 'SIGKILL')`

### 验证

- 单测：spawn 一个会再派生孙进程的 mock agent → dispose → 孙进程 pid 探测为不可达（`process.kill(pid,0)` 抛错）。
- 回归：现有 `tests/` 里 spawn 相关用例全绿；确认 `detached` 不影响 stdio 通讯（stdio 仍是 pipe，与 `detached` 正交）。
- 手工：`pgrep -P <acp>` 在 dispose 后应为 0，且 `pgrep -f server-filesystem` 不再残留。

### 注意

- `detached` 会让子进程**脱离**宿主终端的信号传播，必须确保我们所有退出路径都走 `killTree`，否则反而更容易留孤儿。**这是本项的主要风险点，需逐条核对 teardown/失败路径。**
- 不设 `child.unref()`：我们仍要收 exit 事件。

### 本项前提已实测验证（2026-10-28）

写进计划前实测了三个关键假设，**全部成立**：

| 假设 | 实测结果 |
| --- | --- |
| `detached: true` 是否会破坏 stdio pipe 通讯 | **不破坏**：向子进程 stdin 写 `hello`，正常收到 `ECHO:hello`（stdio 与 detached 正交） |
| `process.kill(-pid)` 能否回收**孙进程** | **能**：`detached=true` 时树 pid=13639、孙 pid=13640，对 `-13639` 发 `SIGKILL` 后孙进程 `alive=false` |
| 不加 `detached` 只 kill 直接子进程会怎样 | **孙进程成孤儿**：`detached=false` 时只 `tree.kill('SIGKILL')`，孙进程 `alive=true` —— 正是现场现象 |

**结论：`detached` 是必要条件，不是可选项。** 只把 `child.kill` 换成 `killpg` 而不加 `detached` 是无效的（孙进程与父同组，`-pid` 语义也不正确）。

## 4. P1：ephemeral 串行化 + 复用（峰值主因）

### 方案 A（推荐）：按 route 串行化 ephemeral

用现成的 `SessionCoordinator`，为 ephemeral 单独开一条 key（与用户会话的 key 隔离）：

```ts
// :899-901 附近
const ephemeral = dshSessionId === undefined || purpose !== undefined
// NEW: ephemeral 也串行化，但不与用户会话抢同一把锁
const ephemeralKey = `\u0000ephemeral\u0000${route}\u0000${purpose ?? ''}`
const key = this.bindingKey(route, dshSessionId ?? '')
const release = await this.coordinator.acquire(ephemeral ? ephemeralKey : key)
```

- **效果**：N 个并发标题/压缩请求 → 串行 → **同一时刻最多 1 个临时会话**。峰值从 N×10 降到 1×10。
- **风险**：串行会**增加标题/压缩的等待时间**。这是必须接受的权衡——它们本就是短任务；若实测不可接受，见方案 B。
- 若担心串行导致超时，加**并发上限 2**（信号量）而非完全串行，作为折中。

### 方案 B（更彻底，但改动大）：复用单一临时会话

同一 `route` 复用一个专用的 ephemeral 会话，在其上串行执行 purpose 请求，完成后**不关闭**、留给下一个请求用。

- **效果**：不仅并发受控，连**会话总数**也从 N 降到 1（MCP 也只起 1 套）。
- **风险**：会话状态污染（前一请求的对话历史/工具状态残留）。`purpose` 请求通常携带完整 messages，可接受；但需要确认 ACP 会话是否可安全复用而不累积上下文 —— **需先做 P4 式的单会话循环验证**。
- **建议**：先做 A（低成本、可逆），观察线上是否够；不够再上 B。

### 验证

- **失败测试先行**：`N 个并发 purpose 调用 → 断言 mock agent 收到 session/new 次数 == 1`（方案 A 串行下应为 1；若保留并发 2 则 ≤2）。
- 回归：用户正常对话路径（非 ephemeral）不受影响 —— 仍按 dshSessionId 串行。
- 手工：冷启动 DSH（零交互），`pgrep -P <acp> | wc -l` 应从 65 降到个位数。

## 5. P4：探测路径单飞 + 单会话循环（次因，但便宜）

**`src/host/service/acp-agent.ts:512-536`** — 给 `discoverEffortsForModel` 加 in-flight 共享，对齐同文件 `:502` 已有的 `this.discovering ??=`：

```ts
private readonly discoveringEfforts = new Map<string, Promise<AcpSessionEfforts | undefined>>()

async discoverEffortsForModel(model, cwd, signal) {
  const live = await this.ensure(signal)
  const key = this.modelEffortKey(live.generation, cwd, model)
  const cached = this.modelEfforts.get(key)
  if (cached !== undefined || this.modelEfforts.has(key)) return cached
  let inflight = this.discoveringEfforts.get(key)
  if (inflight === undefined) {
    inflight = this.runEffortDiscovery(live, model, cwd, key).finally(() => this.discoveringEfforts.delete(key))
    this.discoveringEfforts.set(key, inflight)
  }
  return this.withAbort(inflight, signal)
}
```

再加**单会话循环读全档位**（进一步把 N 个探测会话压到 1 个）：
- 1 个专用探测会话，循环 `set_config_option` 切模型，逐个读 `thought_level`；
- 读不到的模型返回 `undefined`（**降级安全**，gemini-cli 就是这种）。
- 需要 `restart()` / `dispose()` 时清理该探测会话。

**验证**：`N 个模型并发 resolveModel → 断言 session/new 次数 ≤ 1`（现有 `model-catalog` 测试可扩展）。

## 6. P5：会话租约（兜底）

给**临时/探测会话**登记创建时间，`idleTimeoutMs` 之外再加一条租约：
- 超时未使用 → 主动 `closeSession` + 从登记表移除；
- **不能只依赖 `closeSession`**（对不支持 close 的 agent 无效），需配合 P2 的 `killTree` 或至少记录以便诊断。

优先级低，因为 P1/P4 已消除主要来源；它的价值是**防止未来新增路径再泄漏**。

## 7. P3：MCP 不按会话复制（收益大，风险中高）

三个候选方向，**实施前必须先确认 agent 行为**：

| 方向 | 做法 | 前提/风险 |
| --- | --- | --- |
| a) 复用同一 MCP 连接 | 一次 agent 进程内，多个会话共享 MCP server | ACP 协议里 `mcpServers` 是 **per-session** 传入的，能否共享取决于 agent 实现 —— **未确认** |
| b) 按需懒连接 | 只有会话真正需要工具时才传 MCP | 需要判断「这个会话会不会用工具」，不可靠 |
| c) `forwardMcp: false` 默认 | 默认不转发 MCP | 用户若依赖 MCP 工具会失效，**破坏功能** |

**倾向**：先做 b 的保守版——**ephemeral / 探测会话一律传 `[]`**（它们从不需要工具）。这已能消掉临时会话那部分的 MCP 放大，且零风险。真正的「共享连接」需先验证 ACP 语义，列为后续研究项。

> 注：`discoverModels` / `discoverEffortsForModel` 已经显式传 `[]`，是对的；**缺口在 `ensureSession` 的默认透传**。因此 P3 的最小改动是：**让 ephemeral 的 `ensureSession` 也传 `[]`**（`acp-adapter.ts:827` 加一个参数）。

## 8. P6：升级 agent 包名（用户侧，非代码）

- `@zed-industries/claude-code-acp` → `@agentclientprotocol/claude-agent-acp`（0.22.0 起支持 `session/close`）。
- **只能缓解**：close 能回收 claude 主进程，但**清不掉 MCP 孙进程**（事实 8），且该 agent 仍无会话数上限。
- 属于**配置/文档改动**：更新 README 示例与已知限制说明，不改代码逻辑。

## 9. 验收标准

| 层 | 标准 |
| --- | --- |
| 单测 | ① 并发 purpose → session/new ≤ 1（或 ≤ 上限）② dispose 后孙进程不可达 ③ 探测并发 → session/new ≤ 1 |
| 仓库门禁 | `node node_modules/typescript/bin/tsc --noEmit` 与 `node node_modules/vitest/vitest.mjs run` 全绿 |
| 手工（真机） | 冷启动零交互 10 分钟：`pgrep -P <acp>` ≤ 个位数；`pgrep -f server-filesystem` 不再成批出现；退出后无残留 |
| 回归 | 正常对话、取消、审批、模型切换、历史恢复均不受影响 |

## 10. 不在本计划内（明确排除）

- 改宿主 `catalog.ts` 的 `Promise.all` —— 责任在 adapter，宿主零改动。
- 让 agent 侧实现会话上限 —— 不是我们能改的。
- 伪造 `tool/call` 等记录 —— 仓库红线。
- 换 agent 实现 —— 超出本 bug 范围。

## 11. 建议拆成实施单

| 单 | 内容 | 依赖 |
| --- | --- | --- |
| T1 | P2 进程树回收（detached + killTree） | 无 |
| T2 | P1 ephemeral 串行化（方案 A） | 无 |
| T3 | P4 探测单飞 + 单会话循环 | 无 |
| T4 | P3 最小版：ephemeral 的 ensureSession 传 `[]` | 无 |
| T5 | P5 会话租约 | T1 |
| T6 | P6 文档/升级说明 | 无 |

T1/T2/T3/T4 可并行；T5 依赖 T1。
