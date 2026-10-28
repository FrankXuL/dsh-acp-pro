<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-df9e72f3-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:57:11.953Z -->
<!-- DSH-BLOCKED-BY: 01 -->
# 02: Host 启停：route 过滤与回合结束回收

**What to build:** 

**Blocked by:** #01

**Status:** ready-for-agent

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

## 进度
