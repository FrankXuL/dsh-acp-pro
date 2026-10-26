# 08 — Known seams & roadmap

The authoritative roadmap is **`docs/roadmap.md`** (v0.1 current → v1.0). This page
summarizes what is unfinished / where to be careful, so a fresh agent does not
re-litigate decisions already made.

## Key seams (as of v0.1)

- **Model selection uses a non-standard extension**. The adapter calls
  `session/set_model` when the agent exposes no `model` config option, but ACP's
  schema has no `session/set_model` (it is a claude-code-acp private extension).
  Target: config-option-first (`session/set_config_option`), matching DSH's own ACP
  server. See `04-extension-points.md` and roadmap §3.
- **Permission card is display-only**. Answers come from the native approval dialog;
  a host RPC + inline card is planned (v0.5).
- **No session lifecycle persistence.** ACP sessions are held in memory
  (`bindings`); restart loses them, history is rebuilt by full-context replay
  (`transcript.ts`). Resume/load/fork is roadmap v0.4.
- **No subagents.** v1 `subagent_update` / v2 child sessions are not implemented;
  nested cards are roadmap v0.6. ACP intent: render subagents outside folded groups.
- **Registry install is not wired.** The settings page has "discover models" but no
  one-click install from the ACP registry (48 agents, distribution-only manifest, no
  capability matrix) — roadmap v0.7.
- **Terminal content is a placeholder** in tool cards; no terminal stream rendering
  (documented limitation, keep it that way — v1 `fs/*`/`terminal/*` are a v2-removed
  non-goal in roadmap §8).

## Explicit non-goals (from roadmap §8)

- **Faking `tool/call` / `tool/result`** — never do this.
- **Hardcoded agent tables** — UI must be driven by `initialize`/`session/new`
  capability declarations, never by agent-name hardcoding. Do not add one.

## DSH internals dependency (compat risk)

- `appendPluginRecord` / `PluginRecordMap` / Conversation Definitions /
  `conversation.chat.node` / settings section mechanics are experimental-external DSH
  API. DSH upgrades require re-verification (see `07-safety-compatibility.md`).

## Career pointers

- v0.2: card redesign against DSH native rows; plan folded to one line; permission
  chip; fix "深度求索中" timer; usage cost badge. v0.3: control plane
  `set_config_option`; commands/modes. v0.4: session lifecycle. v0.5: rich content
  + permission buttons. v0.6: subagents. v0.7: auth + registry. See `docs/roadmap.md`
  for acceptance criteria per version.