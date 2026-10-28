<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: ACP 对齐原生：清理、跨来源切换告知、轨迹与用量对标 -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: wayfinder:map -->
<!-- DSH-IDEMPOTENCY-KEY: deck-ed44a603-5977296 -->
<!-- DSH-CREATED: 2026-10-28T12:01:52.964Z -->

## Destination

把「dsh-acp-pro 与原生 dsh 的差距」收敛成一组已拍板、可直接进 `/to-spec` 的决策：① 仓库只保留当前有效资产（README 重写为产品首页、去掉一次性调研产物、按用户决定移除上游 MIT 归属）；② 跨来源切换（dsh 原生 ↔ ACP ↔ 另一个 ACP）默认不禁止，但在确实有上下文重建风险时给出一次明确告知与确认；③ ACP 回合在原生的轨迹视图与聊天视图里达到与原生等价的可观测性（回合结构、工具上下文、用量/速度），差异以标注而非伪装处理；④ 在扩展新功能之前，先把 Host/Client 按 `surface → domain → transport` 与 `service → view → register` 分层重构到位，使后续能力各有明确落点。

本图产出决策与可执行契约，不直接改代码。

## Notes

- 用户已拍板（2026-10-28）：
  1. 终点形态 = 决策清单 → 再进 `/to-spec`。
  2. 需求 1 许可：**直接删除上游 MIT 归属**（事实与风险记录在 [许可收口](issues/02-许可收口-删除上游-mit-归属的具体边界与自洽叙事.md)）。
  3. 需求 1 README：产品首页形态，**不要截图**。
  4. 需求 2：锁的实际对象是「会话的执行来源 / 模式」（dsh 原生 / claude / codex…），**同一来源内换模型与推理等级不限**；后半场改为「默认不限，跨来源时弹确认」。
  5. 需求 3：范围是**全链路对标**，轨迹只是举例；实现路线为「轨迹 Definition 读插件记录」，**不伪造原生 `tool/call`**；usage 保持「相邻快照差值」并在 UI 标注估算。
  6. 需求 4（新增）：**先完成分层重构（S1–S4），再做需求 2/3 的功能**；切片纯搬运零逻辑改动、各自可回滚。结构见 [ADR-0001](../../docs/adr/0001-layered-restructure.md)，目标图见 [JSON 规格](../../docs/design/dsh-acp-pro-layered.architecture.json)（HTML 为可重现产物，不入库）。
- 子票（7 张，全部已关闭）：
  - [清理边界：哪些文件删、哪些留，交叉引用怎么收口](issues/01-清理边界-哪些文件删-哪些留-交叉引用怎么收口.md)
  - [许可收口：删除上游 MIT 归属的具体边界与自洽叙事](issues/02-许可收口-删除上游-mit-归属的具体边界与自洽叙事.md)
  - [跨来源切换：确认落点、触发时机与降级形态](issues/03-跨来源切换-确认落点-触发时机与降级形态.md)
  - [轨迹契约：插件记录进原生轨迹的可行性边界](issues/04-轨迹契约-插件记录进原生轨迹的可行性边界.md)
  - [用量与速度：ACP 差异的标注口径与数据通路](issues/05-用量与速度-acp-差异的标注口径与数据通路.md)
  - [README 形态：产品首页保留哪几节、开发内容迁到哪](issues/06-readme-形态-产品首页保留哪几节-开发内容迁到哪.md)
  - [分层重构：执行切片、验收口径与架构图资产化](issues/07-分层重构-执行切片-验收口径与架构图资产化.md)
- 复用既有笔记（只记路径 + 一句话结论）：
  - [`docs/design/current-architecture-audit-2026-10.md`](../../docs/design/current-architecture-audit-2026-10.md) —— ACP `usage_update` 是 **session 级累计**而非回合级精确量，现有 `usageDelta` 取相邻快照增量；不能承诺账单级精度。
  - [`docs/design/acp-model-metadata-oss-research-2026-10-28.md`](../../docs/design/acp-model-metadata-oss-research-2026-10-28.md) —— 元数据应惰性解析当前模型 + 单飞/并发上限；与「不按会话复制」的约束同源。
  - [`docs/design/dsh-model-picker-research-2026-10-27.md`](../../docs/design/dsh-model-picker-research-2026-10-27.md) —— `/model` 弹窗无法注入，插件无拦截点；这正是需求 2 不能只靠客户端拦的原因。
- 本轮必读一手源码：`/Users/xulilili/Downloads/闲聊/deepseek-harness`（0.2.1-rc.2, `687f282e`）的 `packages/client/ui-trajectory/src/client/`、`packages/llm/token-meter/src/`；本仓 `src/host/service/acp-adapter.ts`、`src/host/service/chunk-translator.ts`、`src/client/conversation/records.ts`、`src/host/service/transcript.ts`。
- 工程约束不变：每次改动后 `node node_modules/typescript/bin/tsc --noEmit` 与 `node node_modules/vitest/vitest.mjs run` 必须绿；记录只用 `plugin:*` 命名空间；客户端只 `require` 平台种子词；样式只用 `--dsw-*` token。

## Decisions so far

<!-- 每关闭一张票追加一行：- [票名](链接) — 一句话结论 -->

- [清理边界：哪些文件删、哪些留，交叉引用怎么收口](issues/01-清理边界-哪些文件删-哪些留-交叉引用怎么收口.md) — 删 12 个已闭环调研产物与 2 张不再需要的截图；保留 architecture/roadmap/verification/dsh-plugin-dev/skills/.scratch；清理必须先于 README 重写，截图引用在 README:67-77 与 architecture.md:211 两处收口。
- [许可收口：删除上游 MIT 归属的具体边界与自洽叙事](issues/02-许可收口-删除上游-mit-归属的具体边界与自洽叙事.md) — LICENSE 保留 MIT 正文、版权行换 `Copyright (c) 2026 Oasis`；NOTICE 删上游派生段、留第三方组件与 Provider marks；README:291 / 07-safety:36-41 / dsh-plugin SKILL:148 三处同步改写；派生范围因本地无上游副本无法量化，风险显式登记。
- [跨来源切换：确认落点、触发时机与降级形态](issues/03-跨来源切换-确认落点-触发时机与降级形态.md) — 不禁止跨来源切换；客户端捕获 `ModelDirectory.current`（与 `/model` 共用同一份，故能兜住绕行）后弹原生审批框说明三项风险；拒绝则保持原选择；每「会话×来源对」只问一次；策略为 `never` 或无审批服务时降级为放行 + dock 提示，不得把自动拒绝当用户拒绝。
- [轨迹契约：插件记录进原生轨迹的可行性边界](issues/04-轨迹契约-插件记录进原生轨迹的可行性边界.md) — 可做：新建 `target:'trajectory'` 的 Definition，ACP tool-call 以 `kind:'node'` + tool-result 形状进轨迹（技术最小闭环 1 个）；不可做：自带新 contribution kind、plan/permission 进轨迹、伪造 system prompt；ACP 确有 `request/header`，usage pill 与 ContextMeter 本来就该正常。笔记：[acp-trajectory-parity-contract-2026-10-28.md](../../docs/design/acp-trajectory-parity-contract-2026-10-28.md)。
- [用量与速度：ACP 差异的标注口径与数据通路](issues/05-用量与速度-acp-差异的标注口径与数据通路.md) — 数据通路**零改动**（ACP 的 `totalTokens`/`inputTokens`/`outputTokens` 均为必填，`usageDelta` 与 `suppressUsage` 本就正确）；只补三处估算标注（轨迹 usage tab、composer pill tooltip、`ContextMeter` tooltip）；`ContextMeter` 保留百分比而非隐藏，用 tooltip 说明分母可能是推测值。
- [README 形态：产品首页保留哪几节、开发内容迁到哪](issues/06-readme-形态-产品首页保留哪几节-开发内容迁到哪.md) — 收敛为八节 ≤150 行（含 mermaid 架构图、删截图节）；开发节并入 `docs/dsh-plugin-dev/README.md`；限制节由 16 条改六级分组；README 最后一步与功能落地同批提交。
- [分层重构：执行切片、验收口径与架构图资产化](issues/07-分层重构-执行切片-验收口径与架构图资产化.md) — 先做完 S1–S4 重构再动功能；四切片纯搬运零逻辑改动、各自可回滚；验收 = tsc 0 + vitest 全绿（基线 27 文件/204 项不减）+ 新增 `tests/layering.test.ts` + 单文件 ≤400 行；架构图只入库 JSON 规格，HTML 经 `.gitignore` 排除；结构校验 9/9 通过但视觉复核因 Chrome 不可用而记为 pending。ADR：[0001-layered-restructure.md](../../docs/adr/0001-layered-restructure.md)。

## Not yet specified

- 轨迹 tool 行的 schema/diff tab 在 ACP 场景能填多少（ACP 不给 JSON Schema，只给 raw input/output）。
- 移除上游 MIT 归属后，仓库对外分发的合规叙事怎么写在 README/NOTICE 里。

## Out of scope

- 修改 DSH 上游（不新增 slot、不改 `ui-trajectory`、不推上游 PR）。
- 伪造原生 `tool/call` / `tool/result` 会话事件（`AGENTS.md` 明确禁止）。
- 让 ACP 拥有 dsh 自己的工具集（外部 Agent 用自己的工具是既有边界）。
- `/model` 弹窗内部的改造（无法注入）。

## 进度

- 进度：100%（2026-10-28T20:54:19+08:00）：地图收口：7/7 票关闭，Decisions so far 回填 7 条，Fog 已清理，终点达成，可进 /to-spec
- 进度：34%（2026-10-28T20:17:20+08:00）：建图完成：6 张子票 + 4 条依赖边；已闭合清理与许可两票；research 票 04 由子代理并行执行中，03/05 等它解锁
- 进度：100%（2026-10-28T20:53+08:00）：7/7 票关闭；地图终点达成，可进 `/to-spec`。
