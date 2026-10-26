---
name: implement
description: >
  Use when asked to implement a feature or make a concrete change in this repo.
  Trigger keywords: "implement", "add", "build this", "make it work", "shipping
  a change". Not for purely speculative work — every implementation needs a
  stated success criterion.
---

# implement — small-step TDD implementation

**When to reach for it**: Any feature or code change. Never for a bug —
use `diagnosing-bugs`; never for a doc/scaffold-only task — just do it.

**Essentials**:

1. Read the surrounding code first. Trace the real flow the change touches
   (host adapter, record sink, client definition, settings form) before writing
   anything. See `skills/engineering/dsh-plugin/SKILL.md`.
2. Define the **success criterion** for this change in one sentence. What
   observable outcome proves it works? What is explicitly out of scope?
3. Smallest step first. Write the failing test (`node node_modules/vitest/vitest.mjs run`), watch it fail, then implement the minimal code, then make it green.
4. Per step run the repo checks: `node node_modules/typescript/bin/tsc --noEmit`
   and `node node_modules/vitest/vitest.mjs run`. Never let a step end with a red check.
5. Wrap up: run both checks once more, review your diff, commit coherently.

**It's working if**: The success criterion is met, the failing test went
red before green, `tsc --noEmit` is at 0 errors, `vitest` is fully green, and
the diff touches only what the change requires.