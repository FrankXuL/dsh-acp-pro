---
name: diagnosing-bugs
description: >
  Use when something is broken, throwing, misbehaving, or failing tests. Trigger
  keywords: "diagnose", "debug", "bug", "broken", "fails", "crash", "wrong",
  "regression". Distinguish from `implement` (feature work) and `research`
  (fact lookup). In this repo, ACP session/event and record/card integration are
  the highest-leverage places to look first.
---

# diagnosing-bugs

**When to reach for it**: Any report of wrong behavior or failure. Core rule:
fix at the root cause, never at the symptom, and prove the fix with a test.

**Essentials**:

1. **Reproduce first.** Get a reliable, minimal reproduction. For this repo that
   usually means the vitest suite (`node node_modules/vitest/vitest.mjs run`) or
   `scripts/smoke.mts` against a real ACP agent — never guess from the report alone.
2. **Find the root cause.** Trace the code the failure travels through. In this
   repo: a wrong record / card usually lives in `src/host/service/acp-record-sink.ts`
   or `src/client/conversation/records.ts`; a process/JSON-RPC problem in
   `src/host/service/acp-agent.ts` or `acp-adapter.ts`. Ask *why* it happens, not
   just where it surfaces.
3. **Fix at the cause, not the symptom.** One guard in the shared function beats a
   patch in every caller. Do not paper over a bad record with a client-side hack.
4. **Prove it.** Write (or extend) a test that fails on the old code and passes on
   the fix. Run it standalone first, then the full suite.
5. **Check both gates** after the fix: `node node_modules/typescript/bin/tsc --noEmit`
   and `node node_modules/vitest/vitest.mjs run`.

**It's working if**: You can state the root cause in one sentence, the reproduction
fails before the fix and passes after, the fix is at the cause, and `tsc`/`vitest`
are both green.