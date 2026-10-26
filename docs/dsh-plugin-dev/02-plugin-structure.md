# 02 — How a DSH plugin is structured

Based on `package.json`, `cordis.patch.yml`, `tsdown.config.ts`, `tsconfig.json`,
`README.md` §构建.

## 2.1 `package.json`

- `"dsh" → "client"`: the browser inject list and platform.
  ```json
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-chat",
        "@deepseek-ai/dsh-client-session"
      ],
      "platform": "web"
    },
    "bundle": { "patch": "./cordis.patch.yml" }
  }
  ```
  `platform: "web"` tells DSH which artifacts to load for the browser half.
- `"dsh" → "bundle" → "patch"`: `cordis.patch.yml`. It is a Cordis patch whose
  `insert` row declares the Loader entry that mounts this bundle:
  ```yaml
  - insert:
      - id: dsh-acp-pro
        name: dsh-acp-pro
  ```
  The **entry id (`dsh-acp-pro`) is load-bearing**: 0.2 cores key the settings
  section and the client form (`src/client/register/agents-section.ts` uses
  `ENTRY = PLUGIN_ID`) by it. Change it and the "ACP Agents" settings page stops
  appearing (README §安装 注意事项).
- `"exports"` / `"main"` / `"module"` / `"types"` point at `dist/`.

## 2.2 `dist/`

- Built by `tsdown` from `tsdown.config.ts`:
  - `entry { index: 'src/index.ts' }`, ESM, `platform: 'node'` →
    `dist/index.js` + `dist/index.d.ts` (the host half).
  - `entry { client: 'src/client/index.ts' }`, CJS, `platform: 'browser'` with a
    banner/footer that registers the bundle with the web `window.__ModuleLoader__`
    → `dist/client.cjs`. `react`, `react/jsx-runtime`, and `@deepseek-ai/*` are
    `neverBundle` (supplied by the host module table) — `minify`, sourcemap.
- `dist/` is **gitignored** and rebuilt before install / testing. The browser client
  only `require`s platform seed words and profile-loaded packages
  (README §开发 客户端构建约束).

## 2.3 `node_modules/@deepseek-ai/*` peers

These are **symlinks into the upstream `deepseek-harness` checkout** (e.g.
`cordis`, `cosmokit`, `dsh-llm`, `dsh-session`, `dsh-client-ui-*`,
`dsh-client-locale`). They are resolved at typecheck/build time and supplied by
the DSH host at runtime. Rules:

- Never `npm install` them; they are local symlinks. No network npm, full stop.
- Do **not** copy host packages into the plugin's `node_modules` — the plugin
  resolves its own instances and handles cross-instance failures in-band
  (README §安装 注意事项; `apply.ts` comment "不同实例").
- `@deepseek-ai/dsh-client-ui-primitives` is *not* installed (peer range conflict);
  its types are declared in `types/dsh-client-ui-primitives.d.ts` and its runtime
  is provided by the host; tests use `tests/stubs` doubles (README §开发).

## 2.4 Source layout map

```
src/
  index.ts                       Node entry: name/inject/apply/Config/types
  host/
    apply.ts                     host entry: providers, settings, discovery, record sink, MCP
    config/schema.ts             agents config schema (Volatile)
    config/constants.ts          defaults (DEFAULT_MODEL_ID, DEFAULT_CONTEXT_WINDOW)
    service/acp-adapter.ts       LlmAdapter: route -> ACP subprocess; prompt/stream/usage
    service/acp-agent.ts         ACP subprocess + JSON-RPC session (stdio, initialize/new/prompt/cancel)
    service/acp-record-sink.ts   ACP update/permission -> plugin records
    service/mcp-servers.ts       dsh MCP config -> ACP mcpServers
    service/transcript.ts        history -> ACP prompt (incremental / rebuilt / images)
    service/chunk-translator.ts  ACP update -> dsh StreamChunk (text/thinking/usage)
    service/permission.ts        permission policy -> dsh native approval
    service/context-windows.ts   learned context-window cache
    service/prompt-capabilities.ts  learned input-capability cache
    service/request-image.ts     image re-encode target sizes
  shared/
    records.ts                   record names, payload types, PluginRecordMap merge
    constants.ts                 PLUGIN_ID, SETTINGS_NS
  client/index.ts                browser entry: locale/styles/settings/Definitions/renderers
```