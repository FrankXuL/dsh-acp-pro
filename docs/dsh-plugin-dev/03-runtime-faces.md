# 03 — The two runtime faces

Based on `src/host/apply.ts`, `src/client/index.ts`, `src/host/service/acp-adapter.ts`,
`src/host/service/acp-record-sink.ts`, `src/client/conversation/records.ts`,
`docs/architecture.md`.

## 3.1 Host — Node

Runs in the DSH host process. Responsibilities from `apply.ts` and the services:

- **Process management**: `acp-agent.ts` spawns the external ACP agent (stdio
  JSON-RPC), maintains liveness, handshake (`initialize`), and teardown; the
  adapter owns `stream()` per turn.
- **ACP session**: `session/new` (with `configOptions`, `mcpServers` if
  `forwardMcp`), incremental `session/prompt`, `session/cancel`. One ACP session is
  reused per dsh session; drift triggers history rebuild (`transcript.ts`).
- **Adapter**: `acp-adapter.ts` is a dsh `LlmAdapter` registered via
  `ctx.llm.registerAdapter(routes, adapter)`. It converts dsh `GenerateOptions` →
  ACP prompt, and ACP `session/update` → dsh `StreamChunk` (via `chunk-translator.ts`).
- **Record sink**: `startRecording(dshSessionId)` (injected in `apply.ts`) resolves
  the dsh `Session` and returns `createAcpRecordSink(session, logger)`. Each turn
  builds a **`runId`-keyed sink**; ephemeral turns (no session, or a `purpose` like
  title generation) record nothing (`acp-adapter.ts`: `ephemeral = dshSessionId ===
  undefined || purpose !== undefined`).
- **Permission**: `decidePermission` (`permission.ts`) maps the ACP
  `request_permission` to DSH's native approval surface and mirrors the request as a
  record. Policy: `ask | allow | read-only | reject`.

Host registration surface (`apply.ts`):

- `ctx.llm.registerAdapter` / `registerAdapter.replace` — provider routes.
- `ctx.llm.registerConfigurableProviders` — the settings directory entries.
- `ctx.llm.registerModelDiscovery(SETTINGS_NS, …)` — "discover models".
- `ctx.on('loader/volatile-update', safeReconcile)` — hot-edit `agents` re-registers
  routes without restart (0.2 cores).
- `ctx.inject(['settings'], …)` + `settings.installSection` — the settings form.

## 3.2 Client — Browser

Runs inside the DSH web module table. From `src/client/index.ts`:

```ts
export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'configForms', 'uiConversation']
export function apply(ctx: AcpClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), ...)
  ctx.effect(registerStyles, ...)
  ctx.effect(() => registerAgentsSection(ctx), ...)          // Settings -> ACP Agents
  ctx.effect(() => {
    const undo = [
      ctx.uiConversation.events.register(acpToolCallDefinition),   // conversation Definitions
      ctx.uiConversation.events.register(acpPlanDefinition),
      ctx.uiConversation.events.register(acpPermissionDefinition),
    ]
    ...
  }, ...)
  ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'acp-tool-call', ... }, AcpToolCallNode)
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'acp-plan', ... }, AcpPlanNode)
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'acp-permission', ... }, AcpPermissionNode)
  })
}
```

So the client does two distinct registrations:

1. `ctx.uiConversation.events.register(definition)` — tells the conversation engine
   which session events fold into a node and how (`match` / `start` / `update` /
   `buildViewNode`), i.e. the **Conversation Definition** layer.
2. `ctx.slots.register({ name: 'conversation.chat.node', key: … })` — registers a
   **renderer component** for that node **kind** on the keyed chat-node slot.

Settings client work: `src/client/register/agents-section.ts` (settings section via
`ctx.configForms` + `settings.section` slot) and `models-hint.ts` (DOM patch of the
official Models page). i18n is the plugin's own `dshAcpPro` namespace (`src/client/locales/index.ts`, zh/en).

## 3.3 Model-visible vs logged vs client-only

- **Model-visible content**: `ChunkTranslator` output (`text-delta`, reasoning,
  usage) → the dsh model stream. This is what the chat history sends back to the
  next model request.
- **Logged (`plugin:acp/*`)**: the record sink appends `plugin:acp/tool-call`,
  `plugin:acp/plan`, `plugin:acp/permission` via `appendPluginRecord`. Per upstream
  `dsh-session` docs (packages/core/session `src/index.ts`), these are
  **`ignorable` log-only events**: they never enter the model-visible surface, a
  reader that does not recognize them retains and skips them, and fork/resume carry
  them. This is exactly why the plugin uses records instead of faking dsh tool
  events.
- **Client-only presentation**: the cards built from those records on the client are
  pure presentation — they render, never write.

Do not confuse the two: changing a card renderer never changes what the model sees;
the record layer is the source of truth for history reconstruction.