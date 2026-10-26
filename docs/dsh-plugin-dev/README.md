# dsh-plugin-dev — DeepSeek Harness ACP plugin development

Knowledge base for anyone (AI or human) who needs to develop, build, install, or
reason about this repo without local DSH/ACP background. Every claim cites the
code or docs it came from; anything not verifiable in the code is explicitly
marked as a *guess* with its basis.

- `01-overview.md` — what this package is, host vs client vs shared.
- `02-plugin-structure.md` — how a DSH plugin bundle is structured (package.json,
  cordis patch, dist, peers).
- `03-runtime-faces.md` — the host (Node) and client (browser) runtime faces and the
  model-visible vs log-only split.
- `04-extension-points.md` — the three Conversation Node Definitions, MCP
  passthrough, model/effort discovery, permission mirroring.
- `05-build-test.md` — exact build/typecheck/test commands and the profile-local
  build constraints.
- `06-install.md` — how to install/load the plugin in DSH, and the restart-not-hot-reload caveat.
- `07-safety-compatibility.md` — what not to do, licensing, i18n.
- `08-seams-roadmap.md` — known seams and pointer to `docs/roadmap.md`.

Primary source of truth for behavior beyond these notes: `README.md`,
`docs/architecture.md`, `docs/roadmap.md`, and the upstream `deepseek-harness`
checkout that `node_modules/@deepseek-ai/*` symlinks point at.