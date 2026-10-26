# 04 — The extension points used here

Based on `src/client/conversation/records.ts`, `src/client/components/record-nodes.tsx`,
`src/client/index.ts`, `src/host/apply.ts`, `src/host/service/*`.

## 4.1 Three Conversation Node Definitions under `conversation.chat.node`

Each registered **kind** is folded by a `ConversationNodeDefinition` and rendered
by a matching `conversation.chat.node` slot occupant:

| definition / kind | record event | fold key (`match` id) | renderer |
| --- | --- | --- | --- |
| `acpToolCallDefinition` → `acp-tool-call` | `plugin:acp/tool-call` | `${runId}:${callId}` | `AcpToolCallNode` |
| `acpPlanDefinition` → `acp-plan` | `plugin:acp/plan` | `${runId}` | `AcpPlanNode` |
| `acpPermissionDefinition` → `acp-permission` | `plugin:acp/permission` | `${runId}:${requestId}` | `AcpPermissionNode` |

The definitions give each event a `role` of `data.phase` (`start` / `update`). The
engine initializes a node's state from the earliest `start` in the loaded window
and updates from every later match — which is exactly right because **every record
is a complete snapshot** (records carry whole tool/plan/permission state, not
deltas). Renderers live in `src/client/components/record-nodes.tsx`; the slot
declaration `conversation.chat.node` is keyed/registered by dsh's `ui-chat`
(`src/client/apply.ts`, `contract/slots.ts`).

> Note (guess from `design` convention, not verified in code): the plugin uses its
> own `plugin:*`-derived node kinds because dsh's native `tool-call` Chat node is
> registered by the host; a plugin key that collides is rejected by the slot
> registry. The explicit reasoning is recorded in README §为什么不用 dsh 原生工具卡 and
> `docs/architecture.md`.

## 4.2 MCP passthrough

- `src/host/service/mcp-servers.ts`: `collectAcpMcpServers(loader, logger)` reads the
  Loader entry tree for configured MCP servers and maps them to ACP `mcpServers`
  (stdio/http). Un-mappable servers are skipped and logged.
- `apply.ts`: `installMcpServerSource(forwardedServers)` installs the source; it is
  invalidated on `internal/plugin` mount/unload. Per-profile `forwardMcp` toggles
  forwarding per route. Forwarding happens on ACP `session/new`.

## 4.3 Model / effort discovery

- ACP agents advertise `configOptions` (category `model`, `thought_level`, …) during
  handshake / `session/new`.
- `src/host/service/acp-agent.ts` folds a fresh `configOptions` list into a session
  and selects the `model` option; `acp-adapter.ts` maps `thought_level` to a dsh
  reasoning effort and reports `advertisedModels`.
- Selection is applied via `session/set_config_option`; there is also a **non-standard
  fallback `session/set_model`** used when the agent does not expose a model config
  option (flag in roadmap: switch to config-option-first). Roadmap note: ACP has no
  `session/set_model` in schema; it is a claude-code-acp extension.
- `apply.ts` `registerModelDiscovery(SETTINGS_NS, …)` powers the settings "discover
  models" action; models can also be hand-declared per route (`models[]`).

## 4.4 Permission mirroring

- `src/host/service/permission.ts`: policy (`ask|allow|read-only|reject`), read-only
  kinds, and `decidePermission` → DSH native approval (`host.approve`). Fallback to
  `read-only` when no approval answerer exists.
- `acp-record-sink.ts` `permission(request)` mirrors the request: writes a
  `phase:'start', status:'pending'` `plugin:acp/permission` record, returns a
  finisher; on settlement (`allowed|rejected|cancelled`) writes a `phase:'update'`
  record. The card is display-only in this version — the answer still comes from the
  native approval dialog.

## 4.5 Where each extension point lives in `src/`

| Concern | File(s) |
| --- | --- |
| Node Definitions (fold) | `src/client/conversation/records.ts` |
| Card renderers | `src/client/components/record-nodes.tsx` |
| Node slot injection | `src/client/index.ts` |
| Record namespace + shared shapes | `src/shared/records.ts` |
| Record production (snapshot) | `src/host/service/acp-record-sink.ts` |
| ACP session / provider | `src/host/service/acp-adapter.ts`, `src/host/service/acp-agent.ts` |
| MCP passthrough | `src/host/service/mcp-servers.ts`, `src/host/apply.ts` |
| Discovery | `src/host/service/acp-agent.ts`, `src/host/apply.ts` |
| Permission | `src/host/service/permission.ts`, `src/host/apply.ts` |