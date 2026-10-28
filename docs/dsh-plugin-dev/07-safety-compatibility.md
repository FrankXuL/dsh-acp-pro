# 07 — Safety / compatibility

## Do NOT fake native tool events

- Never emit a native dsh `tool/call` or `tool/result` session event for an external
  ACP agent's tools. ACP tools are real external work and are not dsh-initiated calls
  (no dsh tool name/schema/result). Fabricating them would pollute the model-visible
  history and the request stream with invented tool names, parameters and results.
- Stay in the **`plugin:*` record namespace** via `appendPluginRecord`. Records are
  `ignorable`, log-only, skipped-and-retained by unknown readers, and carried by
  fork/resume. See `src/shared/records.ts`, `src/host/service/acp-record-sink.ts`, and
  upstream `packages/core/session` `appendPluginRecord` doc (quoted in `03-runtime-faces.md`).
- **Log records must be truthful**: they are snapshots of real ACP `session/update`
  events and permission requests. Never invent tool calls, plans, statuses or inputs.

## Layering rules

- Host owns record production; client only reads (type-only) and renders. The client
  must never write logs or call into the host.
- The permission card is **display-only** in this version; answers come from DSH's
  native approval dialog. Do not add a competing answer button without the host
  `acp/respondPermission` RPC (roadmap v0.5).

## Client UI conventions

- Client copy lives in the plugin's own locale namespace `dshAcpPro` (`src/client/locales/index.ts`),
  both `zh` and `en`, via the `t()` translator.
- Styling is self-contained with `.dap-*` classes and only the host's `--dsw-*`
  design tokens. The web shell provides no utility CSS for third-party bundles.
- `@deepseek-ai/dsh-client-ui-primitives` is not installed; types are declared in
  `types/dsh-client-ui-primitives.d.ts`, runtime provided by the host, tests use
  `tests/stubs`.

## License & attribution

This repo is published under **MIT** (see `LICENSE`, Copyright (c) 2026 Oasis).
Third-party components keep their own licenses and are listed in `NOTICE`, which
must stay accurate as dependencies change.

The plugin depends on DSH's plugin-record API which is for
`packages/experimental/` and is **not** an official stability promise — flag DSH
upgrades as a compatibility risk when they land.

## Compatibility seams

- `appendPluginRecord` + `PluginRecordMap` are experimental/extenal-facing, not a
  stable contract — re-verify on DSH upgrade: function presence, record-name grammar
  (`plugin:` + lowercase slash-separated segments), `ignorable` semantics, the
  Conversation Definition registration API, and the `conversation.chat.node` slot +
  `PropsRuntime` shape.
- Record shapes are read directly by current definitions/renderers; future field
  changes need version compatibility so old records don't crash the renderer.