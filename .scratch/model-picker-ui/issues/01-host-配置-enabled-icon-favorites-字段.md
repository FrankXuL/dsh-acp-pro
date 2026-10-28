<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-14cd9e20-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:57:11.920Z -->
# 01: Host 配置：enabled / icon / favorites 字段

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## 范围

`src/host/config/schema.ts` 与 `src/shared/types.ts`：

1. `AcpAgentProfile` 增 `enabled`（boolean，默认 `true`）与 `icon`（string，可选）。
2. `Config` 增顶层 `favorites`：`z.array(z.object({ provider: z.string().required(), model: z.string().required() })).default([]).volatile()`。
3. `AcpAgentProfile` 的 client 镜像类型同步加两个字段。

## 约束

- `enabled` 必须在 volatile 的 `agents` dict 内（`agents` 已是 volatile），不要新增非 volatile 顶层字段，否则每次保存整插件重挂载。
- `favorites` 必须 volatile，保存即热更。
- `assertProfiles` 保持「任何已声明路由都要求 command 非空」，不因 `enabled:false` 放宽。

## 验收

- `tsc --noEmit` 绿、`vitest run` 绿。
- 新增单测：schema 解析 `agents.cc.enabled=false` 与 `favorites` 默认 `[]`；volatile 包装存在（读 `.get()` 可用）。
- 不改 apply.ts 的 reconcile 逻辑（留给下一张票）。

## 进度
