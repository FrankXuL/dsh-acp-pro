<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-2aa8e117-5977296 -->
<!-- DSH-CREATED: 2026-10-28T12:03:08.061Z -->
<!-- DSH-BLOCKED-BY: 04 -->
<!-- DSH-ASSIGNEES: lead -->
# 05: 用量与速度：ACP 差异的标注口径与数据通路

Type: grilling

Status: resolved

## Question

ACP 会话要在轨迹与聊天视图里达到与原生等价的用量/速度可观测性，具体要补哪些数据通路，哪些差异必须显式标注而不能伪装？

## Answer

### 一、先订正本票提问里的一条错误假设

原提问担心「Agent 不上报 `totalTokens` 时差值会是 0 而 input/output 非 0」。**该担心不成立**：

`@agentclientprotocol/sdk`（v2 `types.gen.d.ts:3613-3646`）里 `totalTokens`、`inputTokens`、`outputTokens` **三个都是必填 number**，只有 `thoughtTokens`/`cachedReadTokens`/`cachedWriteTokens` 是可选。所以：

- `usageDelta()`（`chunk-translator.ts:104-120`）对三个必填字段取差值，逻辑正确，**无需改**；
- 三个可选字段用 `> 0` 才写入，缺失时不产生假 0，**也正确**；
- 结论：**数据通路不需要任何改动**。`turn-usage.ts:104-118` 对 `totalTokens` 的要求，ACP 会话天然满足。

### 二、定案：数据通路不动，只补标注

| 面 | 现状 | 定案 |
| --- | --- | --- |
| 轨迹 `usage` tab | 已能取到值（来自 `finish()` 的 usage chunk） | **不改造**，仅在 tab 内加一行来源说明 |
| 轨迹 `timing` tab（TTFT / 生成耗时 / tok-s） | 由 delta 时间戳自然得出 | **不改造**，值本就正确 |
| composer `usage` pill | 读 `tokenUsage` 投影，ACP 会话已正常 | **不改造** |
| `ContextMeter` 占用百分比 | 分子来自 usage 事件，分母来自 `request/context` 的 `contextWindow` | **保留显示**，但分母在 ACP 会话里可能是推测值，需标注 |
| 回合级精度 | 相邻快照差值（= 估算，非 Agent 明确声明的回合量） | **标注为估算**，见下 |

### 三、标注文案位置清单（归 `dshAcpPro` locale namespace）

| # | 位置 | 文案要点 | 必要性 |
| --- | --- | --- | --- |
| 1 | 轨迹 `usage` tab 底部 | 「数字为相邻上报快照的差值估算；ACP 只提供会话级累计用量」 | 必须 |
| 2 | composer `usage` pill 的 tooltip | 「ACP 会话：按上报增量估算」 | 必须 |
| 3 | `ContextMeter` tooltip（仅 ACP 路由会话） | 「上下文窗口来自 Agent 上报或配置推测，可能是估算值」 | 必须 |
| 4 | 会话面板（若存在） | 同 #2 的简短版 | 可选 |

不做的事：不给每个数字加后缀（噪音太大）、不在 Chat 卡片里重复标注。

### 四、`ContextMeter` 的信任边界（保留本票最有价值的结论）

`usage_update.size` 是 **Agent 自报的窗口大小**，不是当前占用量。当前代码把它写进 `ContextWindows` 缓存（`acp-adapter.ts:848`），用作**分母**；分子来自 usage 事件。这条链在语义上是对的（分母=窗口，分子=用量），**但分母可能是错的**：

- Agent 可能上报一个与模型真实窗口不符的 size；
- `inferContextWindow` 对模型名的 `1m` 标记猜测（`acp-adapter.ts:588-615`）可能误判。

**定案**：不隐藏百分比（隐藏会让用户以为功能坏了），而是用 #3 的 tooltip 说明来源与不确定性。**这是产品判断：宁可显示带标注的数，也不要隐藏功能。**

### 五、留给实施票的验证项

1. 用一个真实 ACP agent 跑一轮，确认轨迹 `usage` tab 与 `timing` tab 都有值（而非 `—`）。
2. 确认 composer `usage` pill 出现且数值与轨迹一致。
3. 确认 `ContextMeter` 在 ACP 会话里显示的是「窗口大小」而非「0%」。
4. 确认 `suppressUsage` 分支（恢复会话且无基线时）不会把首回合显示成 0 —— 现状是**不发**该回合 usage chunk，需要确认 UI 显示为「无数据」而非「0」。

定案：数据通路零改动——ACP 的 totalTokens/inputTokens/outputTokens 均为必填，usageDelta 与 suppressUsage 逻辑正确；仅补 3 处估算标注（轨迹 usage tab、composer pill tooltip、ContextMeter tooltip）；ContextMeter 保留占用百分比而非隐藏，用 tooltip 说明分母可能为推测值；遗留 4 项实施期验证。

## 进度

- 进度：100%（2026-10-28T20:30:50+08:00）：定案：数据通路不改（ACP 三个关键字段均必填，usageDelta 正确）；只补 3 处估算标注；ContextMeter 保留百分比 + 来源 tooltip
