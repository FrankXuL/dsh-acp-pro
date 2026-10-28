<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-df9e72f3-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:57:11.953Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 02: Host 启停：route 过滤与回合结束回收

**What to build:** 

**Blocked by:** #01

**Status:** resolved

## 范围

`src/host/apply.ts` 与 `src/host/service/acp-adapter.ts`：

1. `reconcile()` 的 `routes` 与 `directoryEntries` 只取 `enabled !== false`。
2. `routeFacts` 不纳入 `favorites`（收藏变化不得触发重注册）。
3. `AcpAdapter` 新增 `retireRoute(route)`：有活跃回合则标记待回收、回合结束再 `dispose()` + `invalidateBindings`；无活跃回合则立即执行。
4. 适配器暴露「该 route 是否仍有活跃回合」查询。
5. 回合结束/取消路径里检查待回收标记并执行回收。

## 约束

- **不能**用「过滤后的 profiles 触发 `sync()`」来实现停用——`sync()` 会立即 `abortTurns` + `dispose()`，违反「正在跑的回合允许跑完」。
- 停用后重新启用要能取消待回收标记。
- 可配置目录条目也要移除（否则官方「模型」页仍显示该行）。

## 验收

- 单测：停用（有活跃回合）→ 注册表少该 route、目录少该条目、回合结束后进程 disposed、绑定失效；无回合时立即回收；回合结束前重新启用 → 不回收。
- 既有 54 项 adapter 测试保持绿。

## Comments

### local — 2026-10-28T09:18:02.147Z

### local — 2026-10-28T09:18:08.048Z
实现并绿：retireRoute 软关闭（回合结束回收 / 重新启用取消 / sync park / 幂等），reconcile 只注册 enabled 路由且 favorites 不触发重注册；tsc 0 / 170 tests，commit 0c221c0。
## 完成（TDD）

**Adapter（`src/host/service/acp-adapter.ts`）**
- 新增 `retireRoute(route)` / `cancelRetirement(route)` / `hasActiveTurn(process)` 与私有 `settleRetirements()`：
  - 无活跃回合 → 立即 `dispose()` + `agents.delete` + `invalidateBindings`；
  - 有活跃回合 → 记入 `retiring`，**不打断**；
  - `unregisterTurn` 在最后一个回合结束时结算 parked retirement；
  - `dispose()` 清空 `retiring`；重复 retire 幂等。
- `sync()` 语义修正：配置里已删（`profile === undefined`）但仍有活跃回合的路由改为 **park**，不再 `abortTurns`——这正是票面点名的坑（原 `sync()` 会立即中断回合）。

**Host（`src/host/apply.ts`）**
- 新增 `enabledRoutes()`：`routes`、`directoryEntries`、`routeFacts` 全部只取 `enabled !== false`。
- `reconcile()` 对停用路由调用 `retireRoute`、对重新启用的调用 `cancelRetirement`。
- `favorites` 不进 `routeFacts`（单测锁定：只改收藏时 provider 列表不变）。

**测试**：`tests/adapter.test.ts` +5（立即回收 / 回合结束才回收 / 取消回收 / 幂等 / `sync()` park）、`tests/plugin.test.ts` +2（停用路由同时从 provider 与可配置目录消失；仅收藏变化不重注册）。

门禁：`tsc` 0、`vitest` 26 files / 170 passed、`dist` 重建。commit `0c221c0`。

**说明**：停用路由的**绑定失效**通过 `invalidateBindings` 完成（会话置空、pending 回合标 unknown），与 `sync()` 原路径一致。

## 进度
