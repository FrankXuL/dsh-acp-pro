<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: ready-for-agent -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c5475164-5977259 -->
<!-- DSH-CREATED: 2026-10-28T08:57:11.993Z -->
# 03: 设置页：enabled 开关与 icon 输入

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** resolved

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

## Comments

### local — 2026-10-28T09:21:16.932Z

### local — 2026-10-28T09:21:23.923Z
实现并绿：编辑表单加 icon 输入与 enabled Switch、draft/utils 全程携带、列表显示「已停用」Tag、Switch 声明与替身补齐；tsc 0 / 176 tests，commit 66c137d。
## 完成（TDD）

- **编辑表单**（`agent-editor-form.tsx`）：新增 `icon` 文本输入 + `enabled` `Switch`（`@deepseek-ai/dsh-client-ui-primitives` 平台种子词，非自造）；旁边显示启用/停用说明文案。
- **draft 与存储**（`agents.types.ts` / `agents.utils.ts`）：`AgentDraft` 增 `icon` / `enabled`；`emptyDraft`、`draftOf`、`profileOf` 全程携带；`EDITED_KEYS` 纳入两者；`validateDraft` 写 `icon`（空串省略）、`enabled`（true 省略=走 schema 默认，false 显式写），**编辑其它字段不会丢已有 enabled/icon**（单测锁定）。
- **列表**（`agents-section.tsx`）：`enabled === false` 的行显示只读「已停用」`Tag`，**不放行内开关**（按 #01 决策）。
- **类型与替身**：`types/dsh-client-ui-primitives.d.ts` 与 `tests/stubs` 补 `Switch`（签名照抄上游 `Switch.tsx`）。
- **locale**：`icon` / `iconHint` / `enabled` / `enabledOn` / `enabledOff` / `disabledTag`，中英各一份。

测试：`client-agents` +4、`client-section` +2（含「已停用」标记与编辑表单字段）。

门禁：`tsc` 0、`vitest` 26 files / 176 passed、`dist` 重建。commit `66c137d`。

**真机待验**：编辑表单里拨动开关后保存 → 该 ACP 从模型选择器消失、设置页行仍在并可重开。

## 进度
