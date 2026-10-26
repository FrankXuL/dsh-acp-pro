---
name: tdd
description: >
  Use when writing or fixing code test-first. Trigger keywords: "tdd",
  "test-first", "red-green-refactor", "write a failing test", "make it green".
  Use with `implement` / `diagnosing-bugs`. Runs the repo's real gates: `tsc
  --noEmit` and `vitest`. Not for doc-only or config-only changes.
---

# tdd

**When to reach for it**: Any behavioral change worth a test — a bug fix, a new
record shape, a new permission policy, a new client definition fold.

**Essentials** (red → green → refactor):

1. **Red.** Write one focused test that encodes the expected behavior. Run it and
   watch it *fail*: `node node_modules/vitest/vitest.mjs run tests/<your-file>`.
   A passing test you have not seen fail proves nothing.
2. **Green.** Write the minimal implementation that makes it pass. Match this
   repo's style (record shapes in `src/shared/records.ts`, folds in
   `src/client/conversation/records.ts`, services under `src/host/service/`).
3. **Refactor.** Tighten without changing behavior; keep the diff surgical.
4. **Both gates**: `node node_modules/typescript/bin/tsc --noEmit` (0 errors) and
   the full `node node_modules/vitest/vitest.mjs run` (all green).

Tests live in `tests/`; ACP agent behavior is covered via
`tests/fixtures/mock-agent.mjs`. Keep assertions at the behavior level — what the
code must do, not how.

**It's working if**: The test ran red before it ran green, `tsc` is clean, the
full suite is green, and the implementation is the smallest thing that satisfies
the test.