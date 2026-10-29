# 05 — How to build and test

## Exact commands

Use the binaries under `node_modules` directly — **do not rely on `npm`**, because
this machine's build is profile-local and has **no network npm access**. All deps
are symlinked into `node_modules` already; an `npm install` that wants the registry
will fail.

```bash
# Typecheck — must stay at 0 errors.
node node_modules/typescript/bin/tsc --noEmit

# Tests — must stay green.
node node_modules/vitest/vitest.mjs run

# Build — produces dist/index.js (host) + dist/client.cjs (browser).
node node_modules/tsdown/dist/run.mjs
```

These are also surfaced as npm scripts (`npm run typecheck`, `npm test`,
`npm run build`) but invoke them this way so they work without touching the network
or mutating `node_modules`.

## Profile-local build constraints

- No `npm install` against a registry; dependencies are prelinked symlinks
  (`node_modules/@deepseek-ai/*` → upstream `deepseek-harness` checkout, plus
  `react`, `vitest`, `tsdown`, `tsx`, `typescript`, `zod`).
- Adding a new dependency requires editing `package.json` and providing the symlink
  yourself — do not expect `npm i <pkg>` to work.
- `dist/` is **gitignored**; `tsdown` `clean: true` rebuilds it from scratch. Always
  build before testing/installing so `dist/` matches `src/`.

## Smoke test

`scripts/smoke.mts` uses the installed `tsx` loader. By default it initializes a
real ACP agent, creates a diagnostic session, and reports protocol, agent,
capability, configuration and mode metadata without submitting a prompt. It closes
the session when supported and cleans up its process and temporary directory.
Append `-- your question` to explicitly run a turn through the adapter:

```bash
node --import tsx scripts/smoke.mts /absolute/path/to/agent
node --import tsx scripts/smoke.mts /absolute/path/to/agent -- your question
```

`commands: null` means no command notification had arrived at the probe snapshot;
an empty array means the agent explicitly reported no commands. Custom metadata,
startup arguments, environment values and credential-like option fields are not
included in this report. Real DSH installation and UI checks are in
[the verification handoff](../dsh-verification-handoff.md).

## Test suite

- `tests/` is vitest. ACP agent protocol behavior is covered by the mock agent in
  `tests/fixtures/mock-agent.mjs` (model discovery & switching, incremental session
  reuse, history rebuild incl. image re-send, all four permission policies, cancel,
  empty response, auth, reasoning level, handshake input capability, learned
  context window, and real cordis + `LlmRuntime` register/unmount/volatile hot edit).
- Record-sink and card definitions have their own unit tests.
- Session controls and persistence have configuration ordering, unknown-turn and
  recovery regressions; bridge tests cover Host/Client registration and panel
  refresh. The smoke helper has a separate mock fixture that verifies the default
  path never submits a prompt. The standard typecheck includes `scripts/`.

## Client build hygiene

After building, you can confirm the client did not bundle host-installed packages:

```bash
grep -o 'require(\`[^\`]*\`)' dist/client.cjs
```

It should only `require` platform seeds (`react`, `react/jsx-runtime`, `react-dom`,
`react-dom/client`, `@deepseek-ai/*`) and profile-loaded entries. Style must come from
the plugin and only the host's `--dsw-*` design tokens — the web shell supplies no
utility CSS.

A client that renders outside the shell's own tree (a portaled menu, for instance)
needs `react-dom` at runtime: bundling it instead ships a second ReactDOM whose
portal container and event roots disagree with the shell's. `dist/client.cjs` should
therefore carry a `require("react-dom")`, not an inlined copy.
