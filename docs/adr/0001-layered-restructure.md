# ADR-0001：按「传输 / 领域 / 表面」三层重构 Host，Client 按「服务 / 视图 / 装配」三层重构

- 状态：提议（Proposed）
- 日期：2026-10-28
- 决策者：待用户确认

## 背景与事实

当前 `src/` 共 8310 行，三层分布：

| 层 | 行数 | 文件数 |
| --- | --- | --- |
| `src/host` | 4075 | 20 |
| `src/client` | 3806 | 33 |
| `src/shared` | 419 | 5 |

问题不是「文件多」，而是**三个文件承担了过多互不相关的变化原因**，且它们都是后续扩展的必经点：

1. **`src/host/service/acp-adapter.ts`（1488 行）** 一个类里同时存在 6 类职责，行号区间可切分：

   | 区间 | 职责 | 变化原因 |
   | --- | --- | --- |
   | 244–535 | 生命周期、注册、`providerInfo` / `listModels` / `resolveModel` / `sync` / `dispose` | DSH 注册契约变化 |
   | 527–707 | 能力探测与元数据（`learnCapabilities` / `modalities` / `promptCapabilitiesOf`） | ACP 能力集变化 |
   | 709–825 | 绑定、持久化、`createBinding` / `bindingOf` / `recordOf` / `persistBinding` | 持久化格式变化 |
   | 826–868 | 会话更新分派（`onSessionUpdate`） | 记录与翻译协议变化 |
   | 869–1007 | 会话建立、取消、结果结算 | 会话生命周期变化 |
   | 1009–1390 | 回合编排 `run()`（含 `ephemeral` 串行、空闲超时、取消宽限、待决审批） | 回合语义变化 |

   这 6 类变化原因彼此独立：改轨迹记录不该碰回合编排，改持久化不该碰元数据。

2. **`src/host/service/acp-agent.ts`（880 行）** 同时是「stdio JSON-RPC 传输」与「ACP 协议语义」：进程启动/kill 树、握手、`session/new`、`set_config_option`、`prompt`、取消、模型/档位探测缓存，全在一个类。

3. **`src/client/components/model-seat.tsx`（577 行）** 同时是「数据选择（来源过滤/收藏/当前项）」与「UI 呈现（rail/搜索/键盘/定位）」，而后者已在 `service/model-seat-sources.ts` 部分拆出、前者没有。

同时，**已有正面先例**：`session-coordinator.ts`（28 行，单一职责的 FIFO 锁）、`chunk-translator.ts`（120 行）、`transcript.ts`（193 行）都是「一个文件一件事」。说明这个仓库本来就接受「窄模块」，只是大文件没跟上。

## 决策

采用**按变化原因分层**，而不是按技术类型分层（不分 `controllers/`、`utils/`）。

### Host：三层

```
src/host/
  transport/          ← 与外部进程/协议打交道，不含 DSH 语义
    acp-process.ts      进程启动、kill 树、stdout/stderr 解析（从 acp-agent 抽出）
    acp-protocol.ts     握手、session 生命周期、prompt/cancel、config option（acp-agent 剩余）
  domain/             ← 纯语义，可单测、不碰 ctx/宿主服务
    binding.ts          绑定模型与持久化记录互转
    binding-store.ts    （现有 session-store.ts 移入）
    turn.ts             回合状态机（settle 优先级、pending、unknown）
    capabilities.ts     能力探测与缓存（现有 prompt-capabilities.ts + context-windows.ts）
    transcript.ts       历史 → prompt（现有）
    chunk-translator.ts （现有）
  surface/            ← DSH 契约适配，唯一允许读 ctx 的地方
    adapter.ts          LlmAdapter 实现，只做编排：调 domain，注册到 llm
    records.ts          ACP update → plugin:* 记录（现有 acp-record-sink.ts）
    session-control.ts  Typert 桥（现有 dsh-session-control.ts）
    apply.ts            插件入口（现有）
```

**依赖方向铁律**：`surface → domain → transport`，反向禁止。`domain` 不得 import `surface` 或读 `ctx`。这条用 lint 或测试固化（见验收）。

### Client：三层

```
src/client/
  service/            ← 纯数据与决策，可单测，不 import react
    model-sources.ts     来源过滤/排序（现有 model-seat-sources.ts）
    favorites.ts         （现有）
    selection.ts         当前项/可用性判定（从 model-seat 抽出）
    agents.ts            设置文档读写（现有）
  view/               ← 只做呈现，不写业务判断
    model-seat/          577 行拆成 rail + search + list + panel 四个文件
    record-nodes.tsx     （现有 350 行，保持）
    session-control/     （现有 345 行）
    settings/            agents-section + agent-editor-form + agent-import-view
  register/           ← 槽位装配（现有，保持）
```

**铁律**：`view` 不 import `service` 之外的东西做判断；`service` 不 import react。

### shared：保持现状

`src/shared`（419 行）只放 Host 与 Client 都读的契约（记录名、payload、配置类型、session-control 协议）。**不因为重构而扩大 shared**——它每加一个字段都是两端的兼容成本。

## 为什么是这三个层，而不是别的

- **不按「一个 ACP agent 一个模块」分**：agent 是运行时数据，不是代码结构，分不出来。
- **不按「记录/渲染」两端分**：那已经是现状（host/client），问题是每端内部还有多层变化原因。
- **不引入 DI 容器或抽象工厂**：仓库 `AGENTS.md` 要求「最小代码、不为单一实现写接口」。本方案只移动代码边界，不新增抽象类型。

## 扩展性收益（对应 roadmap 的 P3/P4）

| 后续要加的能力（roadmap） | 当前会改哪个文件 | 重构后改哪个文件 |
| --- | --- | --- |
| 工具行 schema/diff 进轨迹（本图票 04） | client/conversation/records.ts + 新 Definition | 同左，不碰 host |
| ACP v2 适配（P4） | acp-agent.ts + acp-adapter.ts（两个大文件） | 新增 `transport/acp-v2.ts`，domain/surface 不动 |
| fs/terminal 客户端能力（P4） | acp-adapter 的 run() 内部 | `domain/turn.ts` + `surface/adapter.ts` 各一处 |
| 子会话显示（P4） | model-seat + session-control 都改 | `service/selection.ts` + `view/session-control/` |
| 用量精度改进（票 05） | chunk-translator + adapter.finish | `domain/usage.ts`（新，133 行内） |
| 认证诊断（P4） | acp-agent 内部 | `transport/acp-protocol.ts` |

## 不做什么（避免重构变成重写）

- **不改行为**：这次是纯结构调整，测试必须全绿且断言不变。
- **不动 `dist` 构建产物结构**：`tsdown.config.ts` 的入口不变，仍是 `src/index.ts` / `src/client/index.ts`。
- **不重命名对外契约**：`plugin:acp/*` 记录名、`acpSessionControl` 服务名、`dsh-acp-pro` 包名与 bundle id 全部不变。
- **不一次性搬完**：分 4 个切片提交，每片独立可回滚（见下）。

## 实施切片（每片都必须 tsc + vitest 全绿）

| 切片 | 内容 | 风险 | 可独立回滚 |
| --- | --- | --- | --- |
| S1 | 抽出 `domain/turn.ts`（回合状态机），adapter 只调用 | 中（回合语义） | 是 |
| S2 | 抽出 `domain/binding.ts` + `binding-store.ts` | 低（纯数据） | 是 |
| S3 | 拆 `transport/` 为 `acp-process.ts` + `acp-protocol.ts` | 中（进程/协议） | 是 |
| S4 | 拆 `client/view/model-seat/` 四文件 + `client/service/selection.ts` | 低（纯表现） | 是 |

S1/S2 先做，因为它们是 S3/S4 的依赖前提；S3 与 S4 可并行。

## 验收

1. `node node_modules/typescript/bin/tsc --noEmit` 退出码 0。
2. `node node_modules/vitest/vitest.mjs run` 全绿，**测试文件数不减少、断言不改**（基线：27 个测试文件 / 204 项测试，2026-10-28 实测）。
3. 新增一条依赖方向测试：`domain/` 下任何文件不得 import `surface/`，不得出现 `ctx.` / `@deepseek-ai`（除类型）。
4. 单文件行数上限：`host` 与 `client` 下任一 `.ts/.tsx` ≤ 400 行（`model-seat.tsx` 577 → 拆分后每片 ≤ 300）。
5. 真机冒烟：安装后跑一轮 ACP 对话 + 打开轨迹视图，卡片与记录行为不变。

## 后果

**正面**：每个后续能力落点从「大文件里的某段」变成「一个可命名的模块」；单测可以按 domain 直接测，不需要起进程。

**负面**：文件数从 58 增加到约 75；import 路径变长；一次性移动代码会产生大 diff（但纯移动，review 可只看结构）。

**风险**：`acp-adapter.ts` 的 `run()` 是 380 行的状态机，抽出 `turn.ts` 时容易引入时序 bug。缓解：S1 只做**搬运 + 类型提取**，不改任何一行逻辑，且用现有 27 个测试文件、204 项测试作为回归网。
