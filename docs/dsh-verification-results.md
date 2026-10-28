# DSH 实机验收结果（dsh-acp-pro）

- 验收日期：2026-10-27（Asia/Shanghai）
- 工作区：`/Users/xulilili/Downloads/dev/code/dsh-acp-pro`
- 执行者：本工作区 DSH 会话（Lead）+ 一个 UI 验收子代理
- 本文件区分四类证据：**实机证据**（真实 DSH / 真实 Agent / 真实 GUI 观察）、**确定性回归**（仓库内可重复执行）、**源码推断**（只读代码得出的契约）、**未验证或环境受阻**。任何未取得运行证据的项目都不写作通过。
- 未修改 DSH 上游，未安装新依赖，未提交或发布，未改动任何 `src/` 源码。本次创建的全部临时探针文件已删除。

---

## 1. 真实运行组合

| 项 | 观测值 | 证据 |
| --- | --- | --- |
| 承载本会话的 DSH | `0.2.1-rc.3` | `dsh --version` → exit 0（`/Users/xulilili/.local/bin/dsh` → 应用内 `@deepseek-ai/dsh/lib/bin.js`） |
| 本机 checkout（开发用） | `deepseek-harness-pkg 0.2.1-rc.1`，依赖 `@deepseek-ai/dsh 0.2.1-rc.2` | `.../dsh-tauri/dependencies/dsh/package.json` |
| 桌面应用 | `/Applications/DeepSeek Harness.app`（`app.asar`），另有 `/Applications/DSH Tauri.app` | `ls /Applications` |
| 承载 profile | `tauri`（`DSH_PROFILE=tauri`，`DSH_PROFILE_DIR=/Users/xulilili/.dsh/profiles/tauri`） | 运行时环境变量 |
| 承载 GUI 端点 | `http://127.0.0.1:3080`（pid 91573） | `lsof -nP -iTCP:3080` |
| **验收用 DSH_HOME（隔离）** | `/tmp/acp-home`（临时目录） | 本次新建 |
| 验收 profile（web） | `acpv`，端口 **3081** | `dsh --profile acpv --port 3081 --no-open` |
| 验收 profile（headless） | `acph` | `dsh --profile acph --json …` |
| 插件来源 | `link:/Users/xulilili/Downloads/dev/code/dsh-acp-pro` → `<profile>/node_modules/dsh-acp-pro` 指向本工作区 | `realpathSync` 输出为工作区绝对路径 |
| 插件是否真的加载 | 是。`--dump-config` 输出含 `# == dsh-acp-pro` 与 `- id: dsh-acp-pro` | `dsh --profile acpv --dump-config`（exit 0） |
| 承载 profile 是否已装本插件 | **否**。`~/.dsh/profiles/tauri/package.json` 未声明 `dsh-acp-pro`；其中存在的是**另一个**插件 `dsh-tauri-acp`，且 `disabled: true` | `cordis.patch.yml:80-82` |

> 结论：本批验收在一个**独立、临时、从 shipped 模板新建**的 profile 中完成，承载会话的 `tauri` profile 与 `:3080` 实例**未被安装、重启或改动**。因此本文件证明的是“插件在真实 DSH 运行时中可加载并工作”，**不等于**“用户日常实例已加载本插件”。

### 已认证的 Agent（真实 ACP 握手与回合）

| 路由 | Agent / 版本 | 握手能力 | 真实回合 |
| --- | --- | --- | --- |
| `cc` | `@zed-industries/claude-code-acp 0.16.1`（经 `127.0.0.1:3425` magpie 代理，已认证） | `loadSession:true`，image:true，mcp http+sse，**close 不支持**；**不宣告任何 config option**；5 个 mode；131 个命令 | ✅ 完成（见 §3.3） |
| `flick` | `flick 1`（MyFlicker ACP） | `loadSession:true`，image:false，无 mcp；`model` select（28 值）；无 mode/命令 | ✅ 完成（内容由 Agent 自身重复发送，见 §4.3） |
| `oc` | `OpenCode 2.0.32` | `loadSession:true`，image:true，mcp http，**close 支持**；`model`/`effort(thought_level)`/`mode` 三类 select；`modes`/`commands` 快照为 `null` | ⚠️ 握手与元数据成功；**真实回合被环境阻断**（模型端点 `ConnectionRefused`） |

`modes: null` / `commands: null` 表示快照时尚未收到相应通知；脚本语义为：`[]` 才是 Agent 明确报告空列表。

---

## 2. 仓库门禁（本次执行）

| 命令 | 退出码 | 日志 |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | **0** | `/tmp/acpv/gate-tsc.log` |
| `node node_modules/vitest/vitest.mjs run` | **0**（16 files / 129 tests passed） | `/tmp/acpv/gate-vitest.log` |
| `node node_modules/tsdown/dist/run.mjs` | **0**（Host ESM+dts、Client CJS） | `/tmp/acpv/gate-build.log` |
| `git diff --check` | **0** | 本次执行 |

工作区 `git status --short` 与验收开始时一致（47 项既有改动，全部为上一会话的成果）；本次未新增或修改任何受版本控制的文件。

---

## 3. 已通过项（实机证据）

### 3.1 加载与设置界面
- 真实 GUI 观察：设置导航出现 **`ACP Agents`** 页；三个条目 MyFlicker/`flick`、Claude Code/`cc`、OpenCode/`oc`，各含路由名、`自动发现模型`、命令行与 `编辑`/`删除`。
- 编辑器 `编辑 cc` 含字段：路由名、显示名、启动命令、参数、环境变量、认证方法、权限策略（观测值 `ask`）、图片输入、模型 + `添加模型` + `发现模型`。
- 截图：`/tmp/acpv/shots/05-settings-acp.png`、`/tmp/acpv/shots/07-cc-editor.png`（由子代理在真实 GUI 中采集；令牌已脱敏）。

### 3.2 Provider 路由注册
`--dump-config` 中出现 `- id: dsh-acp-pro`（exit 0）；headless 真实会话能按路由名 `cc`/`flick` 选中并完成回合。

### 3.3 基础对话与流式输出
- `cc`：`--profile acph --json "Reply with exactly the word PONG and nothing else."` → `final: "PONG"`，**exit 0**，转写记录 `assistant/message` 为单条。
- `cc`（恢复会话）：`--session-id session-c54c605b… "What is 2+2?"` → `final: "4"`，**exit 0**。

### 3.4 真实工具调用与记录真实性
prompt：「读取 note.txt 并告诉我第二行」→ Agent 真实执行 `Read File`，DSH 会话日志（zstd 解码后）出现 4 条 `plugin:acp/tool-call`：
- 全部为 `plugin:acp/*` 命名空间、`ignorable: true`；**没有伪造原生 `tool/call`/`tool/result` 事件**。
- `locations` 为真实绝对路径 `/private/tmp/acp-work3/note.txt`；`input` 为真实 `{"file_path": …}`；`status` 经历 `pending → completed`。
- 另一次 `execute` 工具同样产生真实记录（`wc -l big.txt`）。

### 3.5 长输出截断
`cat big.txt` 的工具输出在记录中为 **4024 字符 + `… (N chars omitted)`**，并非完整 28KB 原文。客户端另有 `tool.previewTruncated` 提示路径（`record-nodes.tsx:182`）。

### 3.6 原生权限（ask 与 allow 两条路径）
| 策略 | 观测 | 证据 |
| --- | --- | --- |
| `ask`（无可用审批者） | 真实执行被拒：`perm-marker.txt` **未创建**；`plugin:acp/permission` 记录 `start(pending)` → `update(rejected)`，**恰好一次**；工具记录 `status: failed`，输出为明确的“用户拒绝”文案 | `/tmp/acpv/perm-allow.log` |
| `allow` | 同一命令真实执行成功：`perm-marker2.txt` 被写入内容 `hello-perm-test`；Agent 回复 `DONE`，exit 0 | `/tmp/acpv/perm-allow2.log` |

> 权限结果只结算一次：pending 与终态各一条记录，终态后无新增。

### 3.7 模型与思考强度（真实 Agent 元数据）
- `cc`：`listModels` → 4 项（`default` 合成项 + `opus` / `opus[1m]` / `haiku`）。
- `oc`：`listModels` → 24 项（合成 `default` + 23 个 Agent 广告模型）。
- `oc.resolveModel('opencode/deepseek-v4.1-flash-free')` → 真实 reasoning：`efforts = low, high, max, default`，`defaultEffort = default`，`inputModalities = ["text"]`。
- `cc.resolveModel('default')` → `inputModalities = ["text"]`（该 Agent 不宣告 thought_level，故 `reasoning` 缺省）。

### 3.8 跨会话隔离
两个不同 provider、两个 DSH 会话**并发**流式：会话 A（`cc`）产出 `FROM_CC`，会话 B（`flick`）产出 `FROM_FLICK…`，各归各的会话，无串扰、无交叉。

### 3.9 持久恢复（跨进程）
对同一 DSH 会话 `--session-id` 重新启动新进程：同一 `acpSessionId` 被复用（`48df077a-…`），消费游标由 3 增至 5，回复 `4`，**exit 0**。绑定文件位于 `<profile>/data/dsh-acp-pro/<hash>.json`（`profileContext.dir` 优先，非缓存目录）。

### 3.10 恢复后立即切模型（通知顺序）
强制“加载时配置 = `default`”而“本轮请求模型 = `opus[1m]`”：绑定最终保存 **`opus[1m]`**（切换返回的新确认值），**没有**被旧加载配置 `default` 覆盖；消费游标 3 → 6，`needsFreshInput: false`。DSH 转写中如实记录了 `[model changed: … the session continues with cca/opus[1m]]`。

### 3.11 未知结果（pending）处理
一次 `session/prompt` 因 Agent 端点不可达而失败后，绑定文件保留 `pending`（含 `id` 与 3 个 `messageIds`）。随后在同一会话上重新请求时，插件**没有自动重放**旧的未确认输入：新回合独立发送，游标由 0 → 5，而不是把历史重放一遍。

### 3.12 停止 / abort
真实 `AbortSignal` 在首个增量后触发：整个流在 **10.0 s** 内结束（该 Agent 完成 1→40 计数的同一 prompt 单次需 60–90 s），即请求被真实缩短，而非跑完。

### 3.13 smoke 诊断（默认不发 prompt）
对全部三个 Agent 执行 `node --import tsx scripts/smoke.mts <cmd> …`，均 **exit 0** 并输出协议版本、Agent 信息、声明能力、配置与模式。默认不发送 prompt（`--` 之后才发送）。
受控清理实验：基线 0 个 ACP 子进程 → 运行一次 → **仍为 0**，且未残留 `dsh-acp-smoke-*` 临时目录。

### 3.14 实机复现：路由名不能与上游 provider 重名
以 `opencode` 为路由名时，真实启动报：
`llm-pi-ai (@deepseek-ai/dsh-llm-pi-ai): LlmError: configurable provider "opencode" is already declared`
→ 上游 `dsh-llm-pi-ai` 已内建同名 provider（`"opencode": { env: ["OPENCODE_API_KEY"] }`），**插件路由名必须避开这些内建 id**。这是真实运行时约束，本地 mock 不会暴露。改用 `oc` 后一切正常。

---

## 4. 失败 / 未验证 / 环境受阻（**未**写成通过）

### 4.1 未验证：GUI 检查 2–10
`ui-verifier` 完成了检查 1（§3.1），随后在自建浏览器通道上超时停止，检查 2–10 **未取得 GUI 证据**：
原生模型选择器是否列出三条 ACP 路由、原生选择器内的 per-model 思考强度、插件面板不出现第二个可编辑模型入口、工具卡片的文件位置/diff 跳转与键盘可达性、输入摘要与详情的截断提示、回放旧 `plugin:` 记录、停止按钮在 GUI 中的行为、双会话 GUI 隔离、生成中改配置的等待提示。

- 阻碍原因：会话内配置的 MCP `browser-harness` 报 `server is disconnected`；子代理自建 headless Chrome（独立 profile，未触碰 `:3080`）后仍超时。
- 与之等价的**后端**证据已取得（§3.4–3.13），但“后端正确”不等价于“卡片正确渲染”。**这十项记为未验证。**

### 4.2 环境受阻：`oc` 真实回合
OpenCode 2.0.32 的模型端点返回 `ConnectionRefused`（直连 `/opt/homebrew/bin/opencode run` 同样失败），因此无法取得其完成回合。**是环境问题，不是插件缺陷**：同一插件下 `cc`、`flick` 均完成真实回合。

### 4.3 非插件缺陷：MyFlicker 重复文本
`flick` 的可见回复出现重复（如 `final: "PONGPONG"`）。用**原始 ACP 客户端探针**（绕开本插件）对照：该 Agent 自身发送 `["P","ONG","PONG"]` 三个 `agent_message_chunk`。归属为该 Agent 的发送行为；插件按原样透传（仓库已有回归 `toBe(...)` 钉住逐字透传）。不作为插件缺陷修复。

### 4.4 源码推断（未取得实机证据）
- 执行环境创建 `acpv`/`acph` 时需 `node >= 22.19`；系统 `node 25.9.0` 不被 `dsh` shim 接受（非 semver 形式）。本次改用应用运行时 node。此为**环境事实**，与插件无关。
- `src/host/apply.ts` 的 `settingsNsOf` / `reconcile` 表明路由在 `agents` 为空时**不注册**：这是本次实测“先报 `configurable provider … already declared`、配置改对后才注册”的源码侧解释。

---

## 5. 修复文件

**无。** 本次验收未发现需要修改 `src/` 的缺陷，因此未改动任何源码、未新增回归、未重跑门禁（§2 的门禁是在未改动源码的工作区上执行的，仍然对应当前源码）。

发现的两处“看似缺陷”均已定位到外部原因（§4.2 Agent 端点不可达、§4.3 Agent 自身重复发送），另有 §3.14 一条真实运行约束属于**配置层知识**，建议后续写入文档而非改代码。

---

## 6. 命令退出码与日志位置

| 用途 | 退出码 | 产物 |
| --- | --- | --- |
| 类型检查 | 0 | `/tmp/acpv/gate-tsc.log` |
| 全量测试 | 0 | `/tmp/acpv/gate-vitest.log` |
| 构建 | 0 | `/tmp/acpv/gate-build.log` |
| smoke × 3 Agent | 0 | `/tmp/acpv/smoke-{opencode,claude,flick}.json` |
| 真实回合 `cc` | 0 | `/tmp/acpv/headless-cc.log`、`/tmp/acpv/tool-cc.log`、`/tmp/acpv/longout-cc.log` |
| 真实回合 `flick` | 0 | `/tmp/acpv/headless-flick.log` |
| `oc` 真实回合 | 1（端点不可达） | `/tmp/acpv/headless-1.log`、`/tmp/acpv/longout-cc.log` 对照 |
| 权限 ask / allow | 0 / 0 | `/tmp/acpv/perm-allow.log`、`/tmp/acpv/perm-allow2.log` |
| 恢复 + 切模型 | 0 | `/tmp/acpv/switch-1.log`、`/tmp/acpv/switch-2.log` |
| 恢复 + 未确认输入 | 0 | `/tmp/acpv/unknown-2.log` |
| 隔离 / abort 探针 | 0 | `/tmp/acpv/probe-iso.log` |
| 模型元数据探针 | 0 | `/tmp/acpv/probe-oc.log`、`/tmp/acpv/probe-model.log` |
| GUI 截图 | — | `/tmp/acpv/shots/`（29 张，含 `05-settings-acp.png`、`07-cc-editor.png`） |
| DSH 会话原始日志（zstd） | — | `/tmp/acp-home/sessions/…/session.v4.jsonl.zstd` |
| 持久绑定 | — | `/tmp/acp-home/profiles/acph/data/dsh-acp-pro/*.json` |

未记录任何密钥、令牌或私人聊天内容；日志中出现的审批令牌、`ANTHROPIC_AUTH_TOKEN` 均已脱敏。

---

## 7. 收尾状态

- 验收用隔离实例（`:3081`）、全部由本次拉起的 ACP Agent 子进程、以及子代理的 headless Chrome（`:9333/9335`）**均已停止**。
- 承载会话的 `:3080` 实例**未被触碰**，仍在运行。
- 临时目录 `/tmp/acpv`、`/tmp/acp-home`、`/tmp/acp-work3` 保留为证据，未删除。
- 未提交、未发布、未修改上游。

---

## 8. 验收结论

**有条件通过（后端功能通过；GUI 渲染与交互未验证）。**

- 通过：插件在真实 DSH `0.2.1-rc.3` 中能加载并注册 provider；真实 Agent 的基础对话/流式、工具记录真实性、截断、原生权限（ask 与 allow 两路）、per-model reasoning 元数据、跨会话隔离、跨进程持久恢复、恢复后立即切模型的顺序、未知结果不自动重放、停止，均取得实机证据（§3）。
- **剩余阻塞项**：
  1. **GUI 渲染与交互未验证**（§4.1，检查 2–10）——需要一条可用的浏览器通道（修复或替换当前的 `browser-harness` MCP）才能收口。
  2. **`oc` 真实回合被环境阻断**（§4.2）——需要其模型端点可达。
- **非阻塞但需记录**：路由名不得使用上游内建 provider id（§3.14）；承载 `tauri` profile 目前**未安装**本插件。

> 说明：§3 的“通过”均为**实机证据**；§2 的“通过”为**确定性回归**；§4.4 明确标注为**源码推断**。本文件未把任何环境受阻或未执行项写成通过。
