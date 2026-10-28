<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c5475164-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:57:11.993Z -->
# 03: 设置页：enabled 开关与 icon 输入

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## 范围

- `src/client/components/agent-editor-form.tsx`：加 `enabled`（`Switch`）与 `icon`（文本输入）两个字段。
- `src/client/service/agents.utils.ts`：`EDITED_KEYS`、`profileOf`、`snapshotOf` 白名单携带 `enabled` / `icon`（否则编辑保存丢字段）。
- `src/client/components/agents-section.tsx`：列表行对已停用路由显示只读「已停用」Tag（不加行内开关）。
- `types/dsh-client-ui-primitives.d.ts` 与 `tests/stubs/dsh-client-ui-primitives.tsx`：补 `Switch` 声明与替身。

## 约束

- 开关只在编辑表单里，列表不放行内开关（已拍板）。
- `Switch` 是 DSH primitives 平台种子词，不要自己造组件。

## 验收

- 单测：编辑表单呈现开关与 icon 输入；保存时 `mutate()` 的 ops 含 `enabled` 与 `icon`；列表对 `enabled:false` 显示「已停用」。
- `tsc` / `vitest` 绿。

## 进度
