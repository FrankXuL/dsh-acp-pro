---
name: dsh-plugin
description: >
  Use for ANY work on this DeepSeek Harness (DSH) ACP plugin: understanding the
  codebase, building, testing, installing/loading in DSH, adding a record or
  card, extending the host adapter, or checking compatibility. Trigger keywords:
  "dsh", "plugin", "ACP", "record", "card", "provider", "bundle", "Host/Client
  integration". This skill is the self-contained primer to this repo — start here
  before touching `src/`. Backed by `docs/dsh-plugin-dev/`.
---

# dsh-plugin — developing this DeepSeek Harness ACP plugin

This is the plugin inside this repo. **Read this whole skill before any code
change.** A reader with no DSH or ACP background can reason about and rebuild the
plugin from this page plus `docs/dsh-plugin-dev/`. If a statement here is ever
stale, the doc should cite the code file it was based on and note the guess
(match that convention when you update it).

## What this package is

`dsh-acp-pro` is a **Cordis-based DSH plugin bundle** with two jobs:

1. Run an **external ACP agent** (Codex, Claude Code, Gemini CLI, …) as a DSH
   **model provider** via stdio JSON-RPC (ACP v1), and
2. record the agent's **tool calls / plans / permission requests** as DSH session
   log events (`plugin:acp/*`) so the Web client renders them as cards.

Two runtime faces, one shared type layer:

| Path | Face | Role |
| --- | --- | --- |
| `src/host/` | Node | `apply.ts` registers providers, settings, model discovery; `service/*` manages the ACP subprocess, sessions, records, MCP forwarding. |
| `src/client/` | Browser | `index.ts` registers locales, the settings section, Conversation Definitions and card renderers (`conversation.chat.node`). |
| `src/shared/` | both | `records.ts` defines the `plugin:acp/*` record names/payloads and the `PluginRecordMap` merge; `constants.ts` holds `PLUGIN_ID`/`SETTINGS_NS`. |

The chain: **Host appends complete snapshot records → Web client folds them into
keyed Chat nodes → `conversation.chat.node` renderers draw tool/plan/permission
cards.** Model-visible content is a separate path (`ChunkTranslator`); records are
`ignorable` log-only events that never enter the model-visible surface.

## How a DSH plugin is structured

- `package.json` → `dsh.client`: the browser inject list
  (`@deepseek-ai/dsh-client-ui-*`, `@deepseek-ai/dsh-client-locale`, etc.) and
  `platform: "web"`.
- `package.json` → `dsh.bundle.patch`: points to `cordis.patch.yml`, whose `insert`
  row entry id (`dsh-acp-pro`) tells the Loader to mount this bundle.
- `dist/` (gitignored): produced by `tsdown` from `tsdown.config.ts` →
  `dist/index.js` (host, ESM/Node) + `dist/client.cjs` (browser factory registered
  with `window.__ModuleLoader__`).
- `node_modules/@deepseek-ai/*`: **symlinked peers** into the upstream
  `deepseek-harness` checkout — resolved at build/typecheck, supplied by the host
  runtime at load. Do not install; do not copy host packages into them.
- Host entry `src/host/apply.ts` and `src/index.ts`; browser entry
  `src/client/index.ts`.

## The two runtime faces

- **Host (Node)** — `src/host/apply.ts` wires `agents` config (`Volatile`,
  `loader/volatile-update` hot-edit) → `ctx.llm.registerAdapter` (provider routes)
  and `registerConfigurableProviders`, model discovery, MCP forwarding, and
  `host.startRecording` (→ `createAcpRecordSink`). `AcpAdapter` (`acp-adapter.ts`)
  is the `LlmAdapter`; `acp-agent.ts` owns the subprocess and JSON-RPC
  (`session/new`, `session/prompt`, `session/set_config_option`, `session/cancel`).
- **Client (browser)** — `src/client/index.ts`:
  `ctx.locale.register`, `ctx.uiConversation.events.register` (three Conversation
  Definitions), and `ctx.slots.inject('conversation.chat.node', …)`. Definitions
  live in `src/client/conversation/records.ts`; renderers in
  `src/client/components/record-nodes.tsx`.
- **Model-visible vs client-only**: `plugin:acp/*` records (via `appendPluginRecord`)
  are log-only and never model-visible; the cards built from them are pure
  presentation on the client. Do not confuse the two paths.

## The extension points used here

- **Three Conversation Node Definitions** keyed under `conversation.chat.node`:
  `acp-tool-call`, `acp-plan`, `acp-permission` — fold logic in
  `src/client/conversation/records.ts`, renderers in `src/client/components/record-nodes.tsx`.
- **MCP passthrough**: `src/host/service/mcp-servers.ts` forwards the host's MCP
  servers to the agent's `session/new` (`forwardMcp`).
- **Model/effort discovery**: `src/host/service/acp-agent.ts` +
  `acp-adapter.ts` read `configOptions`; `registerModelDiscovery` in `apply.ts`.
- **Permission mirroring**: `src/host/service/permission.ts` maps the ACP
  permission request to DSH's native approval, and `acp-record-sink.ts` mirrors it
  as a `plugin:acp/permission` record.

## How to build and test

No network npm — deps are symlinked into `node_modules`. Invoke the tools'
binaries directly; **do not rely on `npm` (it cannot reach the registry)**:

```bash
node node_modules/typescript/bin/tsc --noEmit      # typecheck (must be 0 errors)
node node_modules/vitest/vitest.mjs run            # full test suite (must be green)
node node_modules/tsdown/dist/run.mjs              # build -> dist/index.js + dist/client.cjs
```

`dist/` is **gitignored and rebuilt before install**. `scripts/smoke.mts`
(`npx tsx` …) handshakes a real agent and lists models without burn. Details in
`docs/dsh-plugin-dev/05-build-test.md`.

## How to install / load in DSH

- Use plugin_manager `install_bundle('dsh-acp-pro')` into the **profile** (the
  desktop profile dir, e.g. `~/.dsh/profiles/desktop`), or add the dependency +
  bundle by hand. `install_bundle` runs `pnpm add` for the bundle and selects it.
- The plugin loads as a **linked bundle** (`link:` on the profile), so after a
  code change you must **rebuild `dist/` and restart the desktop app** — there is
  **no hot reload** for provider registration (a known DSH caveat; the model picker
  route only appears after restart).
- **Verify it's live**: open the model picker — the ACP route(s) appear under
  their `displayName`; Settings → ACP Agents editors are present. Details in
  `docs/dsh-plugin-dev/06-install.md`.

## Safety / compatibility

- **Do NOT fake native `tool/call` / `tool/result` events.** ACP tool execution is
  real external work; record logs must be truthful. Keep to the `plugin:*` record
  namespace (`appendPluginRecord`), stay log-only, and never invent DSH session
  events that would pollute the model-visible history.
- Use `--dsw-*` design tokens and this plugin's own i18n namespace (`dshAcpPro`,
  zh/en) for any client UI; the web shell does not offer utility CSS.
- **License**: this repo integrates MIT code from `Fleey/deepseek-harness-acp` —
  keep `LICENSE` and `NOTICE` attribution intact; do not strip them.

## Known seams & ongoing work

See `docs/roadmap.md` (v0.2 → v1.0): card redesign against DSH native rows, control
plane `set_config_option`, session lifecycle, subagents, registry. Explicit
non-goals there: faking tool events and hardcoded agent tables are **not** wanted.

## Full guide

Continue to `docs/dsh-plugin-dev/01-overview.md` and the rest of that folder for
the complete knowledge base with per-module pointers.