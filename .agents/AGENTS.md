# AGENTS.md (aka .agents/AGENTS.md)

This file is an exact copy of the repo-root `AGENTS.md`. It exists so agents
that read conventions from `.agents/` see the same rules as those that read
the repo root. Keep the two in sync (edit the root, copy here).

## Think before coding

- Surface assumptions and tradeoffs first. State the expected behavior and the
  edge cases you are covering; if something is genuinely ambiguous, ask before
  writing a large diff.
- Do not start editing until you have a concrete plan: what changes, what
  files, how it is verified.

## Simplicity first

- Minimal code. One obvious implementation beats a flexible one; no speculative
  abstractions, config for values that never change, or interfaces with a
  single implementation.
- Prefer stdlib and the tools already in `node_modules` over new dependencies.
  This repo has a network-constrained build (deps are symlinked into
  `node_modules`); adding a dependency is a significant act, not a casual one.
- Reuse what is already here before writing new helpers. Trace the flow first;
  the shortest working diff that is also correct on edge cases wins.

## Surgical changes

- Touch only what this request needs. Match the existing style (import path
  extensions `.ts`, `as const`, gutter comments, i18n via the `t()` translator).
- Do not refactor code that is not broken. If the request is a doc/scaffold
  task, do not touch `src/` runtime code.
- Keep diffs reviewable. One logical change per commit where possible.

## Goal-driven execution

- Turn the task into a verifiable goal. For a bug, write a failing test first,
  see it fail, then make it pass.
- After **every** change, run the repo checks so the build never regresses:
  ```bash
  node node_modules/typescript/bin/tsc --noEmit
  node node_modules/vitest/vitest.mjs run
  ```
  Both must stay green. See `skills/engineering/dsh-plugin/SKILL.md` for why we
  invoke these binaries directly (no network npm; profile-local build).
- Leave the repo in a better state than you found it: update docs you relied
  on, keep LICENSE / NOTICE attribution intact, commit coherently.

## Specifics for this repo

- This is a DSH plugin bundle: **Host** (`src/host`, Node) runs the external ACP
  agent as a DSH model provider; **Client** (`src/client`, browser) renders the
  tool / plan / permission cards; **shared** (`src/shared`) carries record names
  and types both faces read.
- Do **not** fake native `tool/call` / `tool/result` session events, and stay in
  the `plugin:*` record namespace (`appendPluginRecord`). ACP tool execution is
  real external work; log records must be truthful.
- Build / install: `dist/` is gitignored, so rebuild it before testing or
  installing, then restart the desktop app (plugin is a linked bundle; there is
  no hot reload for provider registration).
- The authoritative DSH plugin-dev guide is
  `skills/engineering/dsh-plugin/SKILL.md` backed by `docs/dsh-plugin-dev/`.
  Read it before touching host/client integration code.