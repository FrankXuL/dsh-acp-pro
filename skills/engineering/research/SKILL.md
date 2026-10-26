---
name: research
description: >
  Use when you need to look up an external fact — a library API, a protocol
  detail, a version change, a docs claim — and write the answer back into this
  repo. Trigger keywords: "research", "look up", "check the docs", "verify",
  "is X supported", "what changed in". Prefer primary sources (upstream repos,
  protocol specs, package source). Related docs: `docs/acp-ecosystem-survey.md`
  and `docs/architecture.md`.
---

# research

**When to reach for it**: The answer is not in this repo's code/docs and affects
how the plugin behaves. Do not guess about DSH or ACP internals — find the
primary source.

**Essentials**:

1. **Confirm the question and the source of truth.** Identify the primary source:
   upstream `deepseek-harness` source (symlinked deps under `node_modules/@deepseek-ai/*`
   and the checkout they point at), the ACP spec
   (`agentclientprotocol/agent-client-protocol`), or the `@agentclientprotocol/sdk`
   types in `node_modules`.
2. **Read the primary source**, not a blog/forum summary. Quote the relevant
   docstring or schema verbatim in your notes.
3. **Record what is *known* vs *guessed.*** If the code can't confirm a fact, state
   the guess and name the file it was based on.
4. **Write findings into `docs/`** with inline citations (file paths, line ranges,
   URLs). Match the tone of `docs/architecture.md`. If the finding contradicts
   current code, say so and cite the code file.
5. Keep notes proportionate — a page of citations for a subtle fact; a paragraph
   for something obvious.

**It's working if**: The finding is grounded in a named primary source, reads
back clearly in `docs/`, and any guess is explicitly labeled as a guess with the
file it was based on.