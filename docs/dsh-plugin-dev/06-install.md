# 06 — How to install / load in DSH

## Install into the profile

DSH loads plugins from the desktop **profile** (e.g. `~/.dsh/profiles/desktop`).
Two equivalent paths:

1. **plugin_manager `install_bundle(spec)`**. The `plugin-manager` service exposes
   `installBundle`/`install_bundle`; it runs `pnpm add <spec>` inside the profile,
   then selects the bundle. (`spec` is the package install spec; for an official
   catalog entry, pass `list_bundles`' `installTarget.spec`.) Source:
   `packages/boot/plugin-manager/src/index.ts:529` and `src/tools.ts` in the upstream
   `deepseek-harness` checkout.
2. **By hand** (README §安装): add to `~/.dsh/profiles/desktop/package.json` —
   ```json
   "dependencies": { "dsh-acp-pro": "link:/path/to/dsh-acp-pro" },
   "dsh": { "profile": { "bundles": ["dsh-acp-pro"] } }
   ```
   then run the profile pnpm install and restart the desktop app.

Either way the plugin is a **linked bundle** — DSH does not copy or hot-reload it;
it pulls `dist/` from your repo path.

## Rebuild + restart, not hot-reload

Registry changes (new provider routes) are not hot-reloadable. After any code change:

1. Rebuild: `node node_modules/tsdown/dist/run.mjs` (recreates `dist/`).
2. Restart the desktop app.

The settings edits (per-route agent config) do hot-edit via the `loader/volatile-update`
`agents` cell without restart — but a source change still needs a rebuild + restart.
The "restart not hot-reload" caveat for provider registration is documented in
`README.md` §限制 and `docs/roadmap.md` (热重载 provider 泄漏 is an upstream caveat).

## Verify it's live

- **Model picker**: after restart, the ACP route(s) appear in the DSH model picker
  under their `displayName` (default: the route).
- **Settings → ACP Agents**: the plugin's settings section is present (right after
  the official Models page) when the host serves the plugin.
- **Direct check**: the settings Section id is `acp-agents` (`agents-section.ts`),
  registered under the profile entry id `dsh-acp-pro`.
- If the route is missing, you edited code or `cordis.patch.yml` — rebuild and
  restart again; also make sure the entry id in `cordis.patch.yml` is still `dsh-acp-pro`.