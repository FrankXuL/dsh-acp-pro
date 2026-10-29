<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-14cd9e20-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:57:11.920Z -->
<!-- DSH-ASSIGNEES: lead -->
# 01: Host 配置：enabled / icon / favorites 字段

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** resolved

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

## Comments

### local — 2026-10-28T09:07:14.332Z

### local — 2026-10-28T09:07:22.784Z
已实现并绿：enabled/icon 入 AcpAgentProfile（enabled 默认 true、command 仍必填），Config 增顶层 volatile favorites + favoritesOf 读取器；tsc 0 / 148 tests 通过。
## 完成（TDD：红 → 绿）

新增 `tests/config-schema.test.ts`（6 项）先跑红，再实现：

- `AcpAgentProfile` 增 `icon?: string`、`enabled?: boolean`（schema 默认 `true`）；client 镜像类型同步。
- `Config` 增顶层 `favorites`（`z.array({ provider, model }).default([]).volatile()`），输出类型设为**可选**——否则所有没声明 favorites 的既有 profile 入参都编译失败（`tests/mcp-servers.test.ts:215` 就是这么暴露的）。
- 增 `favoritesOf(config)` 读取器：处理 volatile 包装与未包装两种形态，返回 `readonly AcpModelFavorite[]`（`Volatile<T>` 产出 readonly，直接当可变数组会 TS4104）。
- `assertProfiles` 未改动：`enabled:false` 仍要求 `command`（单测锁定）。
- `apply.ts` 未改动，符合票面约束。

门禁：`tsc --noEmit` exit 0；`vitest run` 24 files / 148 tests 全绿。

## 进度
