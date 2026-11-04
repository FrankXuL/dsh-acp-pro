# codex-acp 的 MCP 同名去重为何显示成「失败」：机制调研（2026-11-04）

> 触发自一份缺陷报告：选 codex-acp 路由开新会话时，会话里出现
> `[codex-acp] MCP server `context-mode` was not started, because the Codex config
> already defines an MCP server with this name. Codex uses its own entry, or no
> server if that entry is disabled.`，并且它是一条 `failed` 工具调用（红叉卡片）。
>
> 已有笔记不适用的原因：`docs/design/acp-session-lifecycle-mechanism-research-2026-10-28.md`
> 讲的是「MCP 按会话复制导致进程乘法放大」，README 的 `forwardMcp` 一节只讲「传不传 MCP」，
> 两者都不解释「传了却被丢弃并报成失败」。故按 `/research` 规则对上游源码新查一次。
>
> 证据分级：`一手源码` / `本机配置` / `未确认`。

## 结论摘要

1. **不是连不上，是上游主动按名去重。** codex-acp 在 `session/new` 时把请求里的 MCP 服务器与
   Codex 自身配置里的 `[mcp_servers.*]` 做**键名**比对，同名的丢进 `skippedMcpServers`。
   被丢弃的那份**根本不会被启动**，而不是启动失败。
2. **「未启动」不等于「不可用」。** 服务由 Codex 自己的条目提供——本机 `~/.codex/config.toml`
   里 `context-mode` 是启用状态。只有当 Codex 那条被禁用/缺失时，这个丢弃才真的造成能力缺失。
3. **问题出在呈现：上游把「按设计跳过」和「真实启动失败」塞进同一条通道。**
   `McpStartupReporter.skipped()` 复用的就是真实失败用的 `failure()` 构造器：`status:'failed'`、
   `kind:'other'`、`title: mcp__<server>__startup`。下游无从区分「跳过」与「失败」。
4. **本插件照实渲染。** ACP `tool_call` 记录成 `plugin:acp/tool-call`（`status: 'failed'`），
   客户端把它画成红色失败卡片，标题行就是那句 `[codex-acp] ...`。所以用户看到的是一个告警。
5. **放大面比报告里那一条大。** 本机 dsh 侧 10 个 MCP serverName 与 Codex 配置有 8 个重名
   （context7 / fetch / memory / sequential-thinking / filesystem / browser-harness /
   context-mode / serena），每个重名都可能各报一条。
6. **两条可走的路**：路由侧不转发（`forwardMcp: false`，代价是 relay 给 Codex 的 MCP 全丢，
   只剩 Codex 自己配的那几个），或路由 `env` 里设 `DISABLE_MCP_CONFIG_FILTERING=true`
   （代价是同名 server 会真的被启动两份）。插件侧也可以把 `mcp__*__startup` 这类
   `kind:'other'` 的 failed 记录降级成信息行——那是呈现口径的决定，不是本次调研的结论。

## 1. 上游：去重发生在转发之后、启动之前

`一手源码` `@agentclientprotocol/codex-acp` 2.3.0，`dist/index.js:40290-40293`：

```js
let serversToConfigure = requestedServers;
if (shouldDeduplicateMcpConflicts()) {
  const existingNames = await this.getConfigMcpServerNames(projectPath);
  serversToConfigure = requestedServers.filter((mcp) => !existingNames.has(mcp.name));
}
```

- `existingNames` 由 `codexClient.configRead({ includeLayers: true, cwd })` 汇总 effective config
  与各 layer 的 `mcp_servers` 键名得到——即 Codex 自己那份配置，不是 ACP 请求里的。
- 过滤掉的进 `skippedMcpServers`，之后既不 `services.mcp.startServer`，也不进
  `awaitMcpServerStartup` 的 `requestedServers`（`dist/index.js:38038-38040` 用
  `.filter((server) => !skippedServers.includes(server))` 又把它们排掉一次）。
- 开关：`dist/index.js:40643-40644`
  `function shouldDeduplicateMcpConflicts() { const disabledByEnv = process.env["DISABLE_MCP_CONFIG_FILTERING"] === "true"; return !disabledByEnv; }`
  ——默认去重，`DISABLE_MCP_CONFIG_FILTERING=true` 关掉。

## 2. 上游：跳过与失败共用同一条上报通道

`一手源码` `dist/index.js:37945-37950`，`McpStartupReporter`：

```js
static skipped(serverNames) {
  return serverNames.map((server) => failure2(
    server,
    `[codex-acp] MCP server \`${server}\` was not started, because the Codex config already defines an MCP server with this name. ...`
  ));
}
```

`failure2(server, text)` 产出的工具调用：`toolCallId: mcp_startup.<server>.<uuid>`、
`report:'start'`、`kind:'other'`、`title: mcp__<server>__startup`、`status:'failed'`。
`dist/index.js:38092` 起，`publish()` 把 `McpStartupReporter.skipped(...)` 与真实的
`failures(...)` 拼进同一个数组，逐条 `connection.notify(methods.client.session.update)`。
即**协议层面没有「跳过」这个状态**，只能借 failed 表达。

## 3. 本插件侧：全量转发 + 照实渲染

`一手源码`：

- `src/host/transport/acp-agent.ts:244`
  `const forwarded = this.options.profile().forwardMcp === false ? [] : mcpServers ?? installedMcpServers()`
- `src/host/config/schema.ts:48` `forwardMcp: z.boolean().default(true)`
  ——不显式关闭就全量传给 `session/new`。
- `src/host/domain/mcp-servers.ts` 的 `collectAcpMcpServers` 只处理 **dsh 自己内部**的重名
  （同一个 serverName 配了多次时留第一条并 warn），不感知外部 agent 的配置。
- 收到的 failed `tool_call` 在 `src/host/service/acp-record-sink.ts:168` 记成
  `plugin:acp/tool-call`（`status: 'failed'`），客户端 `AcpToolCallNode` 按 `data-status=failed`
  画红叉。

`本机配置`（这台机器，供估计规模，不代表报告人环境）：

| 侧 | 数量 | 说明 |
| --- | --- | --- |
| `~/.dsh/profiles/desktop/cordis.patch.yml` 的 dsh MCP serverName | 10 | fetch / context7 / serena / browser-harness / cloudflare-docs / cloudflare-api / sequential-thinking / filesystem / memory / context-mode |
| `~/.codex/config.toml` 的 `[mcp_servers.*]` | 9 | serena / node_repl / context7 / fetch / memory / context-mode / codegraph / sequential-thinking / filesystem / browser-harness |
| 两边重名 | 8 | 每个都满足去重条件 |

## 4. 未确认 / 待报告人补

- 报告人环境里 Codex 侧的 `context-mode` 条目是否启用——决定这是「纯噪音」还是「真的少了一个 MCP」。
- 除了 context-mode，会话里是否还有其它 `mcp__*__startup` 失败行。
- 报告人的 dsh / codex-acp 版本（本笔记证据来自 codex-acp 2.3.0）。
