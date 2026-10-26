# 01 — What this package is

Based on `README.md`, `docs/architecture.md`, `src/index.ts`, `src/host/apply.ts`,
`src/client/index.ts`.

## One-liner

`dsh-acp-pro` is a **Cordis-based DSH plugin bundle** that (a) runs an external
ACP agent as a DSH **model provider** over stdio JSON-RPC, and (b) records the
agent's tool calls / plans / permission requests as **`plugin:acp/*` session log
events** so the DSH Web client renders cards.

## The three layers

| Directory | Face | Runtime | Responsibility |
| --- | --- | --- | --- |
| `src/host/` | Host | Node | Process management (spawn/monitor the ACP subprocess), ACP session (`session/new`, `prompt`, `cancel`), the `LlmAdapter`, the record sink, MCP forwarding, permission policy. |
| `src/client/` | Client | Browser | Settings page, locale dictionaries, `uiConversation` event Definitions, `conversation.chat.node` card renderers. |
| `src/shared/` | shared | both | Record names & payload types (`records.ts`), shared profile types (`types.ts`), constants. Host produces records; client reads the same declarations type-only. |

Entry points:

- `src/index.ts` exports `name = 'dsh-acp-pro'`, `inject = ['llm']`,
  `apply` (from `src/host/apply.ts`), `Config`, and the shared types — the Node
  side that DSH Loader mounts.
- `src/client/index.ts` is `exports['./client']` (`dist/client.cjs`) — the browser
  factory registered with `window.__ModuleLoader__`.
- `src/host/apply.ts` is where provider routes, settings, model discovery and the
  record-sink hookup all get wired.

## The execution chain

```text
AcpAdapter.stream() ──prompt()──▶ AcpAgentProcess (stdio JSON-RPC)
        │                              │
        │                              ├─ session/update ─▶ ChunkTranslator ─▶ model-visible StreamChunks
        │                              │                     └─ AcpRecordSink.push ─▶ appendPluginRecord ─▶ Session log (plugin:acp/*)
        │                              └─ request_permission ─▶ AcpRecordSink.permission ─▶ plugin:acp/permission
        ▼ Web Client ── UiConversation.events Definitions ──▶ keyed Chat nodes ──▶ conversation.chat.node renderers (cards)
```

Two paths never mix: **model-visible content** comes from `ChunkTranslator`; the
**cards** come from the record layer. If recording fails, it disables itself and
the turn continues (no cards) — see `src/host/service/acp-record-sink.ts`.

## How the provider route works

Each `agents` config entry (`route → profile`) is one model-picker route. When a
conversation selects that route, the request goes to `AcpAdapter`, which keeps a
long-lived ACP subprocess, reuses one ACP session across dsh turns (incremental
prompts), and rebuilds/compresses history when it drifts. `src/host/apply.ts`
registers these through `ctx.llm.registerAdapter` / `registerConfigurableProviders`.

Details: `docs/architecture.md`, `README.md` §模型提供方 / 会话桥接.