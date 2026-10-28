# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context** — this repo shares one vocabulary across all its parts, so there is one `GLOSSARY.md` at the repo root and architecture decisions live in one root `docs/adr/` directory. No `GLOSSARY-MAP.md`, and no per-subproject glossaries.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved. Neither `GLOSSARY.md` nor `docs/adr/` exists yet in this repo — they will be created on first real use, not by setup.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-event-sourced-orders.md
│   │   └── 0002-postgres-for-write-model.md
│   └── agents/               ← this directory: skill configuration, not domain docs
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## This repo's domain, briefly

The vocabulary to watch is the Host / Client / shared split described in [`AGENTS.md`](../../AGENTS.md) and [`docs/architecture.md`](../architecture.md): **Host** (`src/host`, Node) runs the external ACP agent as a DSH model provider, **Client** (`src/client`, browser) renders tool / plan / permission cards, **shared** (`src/shared`) carries the record names and types both faces read. Terms like "record", "card", "provider", and "ACP session" should mean what those documents say they mean. Architecture decisions are recorded in `docs/adr/` (not yet created).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
