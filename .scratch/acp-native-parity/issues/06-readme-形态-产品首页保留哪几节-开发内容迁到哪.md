<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-6cc1034b-5977296 -->
<!-- DSH-CREATED: 2026-10-28T12:03:08.102Z -->
<!-- DSH-BLOCKED-BY: 01, 02 -->
<!-- DSH-ASSIGNEES: lead -->
# 06: README 形态：产品首页保留哪几节、开发内容迁到哪

Type: grilling

Status: resolved

## Question

README 重写为「产品首页」后，具体保留哪几节、删哪几节、每节各承担什么信息，以及不做截图后架构图与证据怎么呈现？

## Answer

### 一、定案：八节结构，目标 ≤150 行

| # | 节 | 保留/新增 | 承担的信息 | 预计行数 |
| --- | --- | --- | --- | --- |
| 1 | 标题 + 一句话定位（中英各一句） | 保留（精简） | 这个插件是什么、给谁用 | 6 |
| 2 | 功能 | 保留（4 小节压缩） | 模型提供方 / 会话桥接 / 执行卡片 / 配置入口 | 32 |
| 3 | 架构 | **保留 mermaid**（用户已定） | 一张 flowchart + 4 行说明 | 22 |
| 4 | 安装 | 保留 | 前置条件 + 3 步 | 24 |
| 5 | 配置 | 保留 17 行字段表 | 唯一权威字段说明 | 26 |
| 6 | 限制 | **保留但按主题重分组** | 见下 | 20 |
| 7 | 开发 | **整节外迁**，只留 2 行链接 | 指向 `docs/dsh-plugin-dev/` 与 ADR | 3 |
| 8 | 许可证 | 重写（见票 02） | MIT + Oasis 版权行 | 4 |

**删除的节**：`## 截图`（67–77 行，用户明确不要截图）整节移除。

### 二、「开发」节外迁到哪里

**并入 `docs/dsh-plugin-dev/README.md`**，不新建文件。理由：那份 README 已经自称「Knowledge base for anyone (AI or human) who needs to develop, build, install, or reason about this repo」，正好是开发节的归属地；新建 `docs/development.md` 会产生第二份开发入口，与 AGENTS.md 的「只保留一个权威来源」冲突。

迁移内容：目录树、客户端构建约束（`--dsw-*` token / 平台种子词 / `ui-primitives` 未安装）、`tsc` + `vitest` 命令、`scripts/smoke.mts` 说明。

README 第 7 节只留：`见 [docs/dsh-plugin-dev/README.md](docs/dsh-plugin-dev/README.md)（开发、构建、测试）；重构计划见 [ADR-0001](docs/adr/0001-layered-restructure.md)。`

### 三、「限制」节的新分组（六组，替代原来的 16 条平铺）

| 组 | 条目 |
| --- | --- |
| **执行模型** | 外部 Agent 用自己的工具，DSH 工具不传给 ACP；MCP 透传的边界与开销；`retryPolicy` 固定 0 次 |
| **可观测性** | 卡片只在 Chat 视图（**轨迹支持见票 04/07 的实施结果，落地后此行需改**）；终端输出是占位；权限卡只展示、答复走原生审批框 |
| **用量精度** | usage 是 session 级累计的相邻快照差值 = 估算；`ContextMeter` 的分母可能是推测值（票 05） |
| **跨来源** | 切换会重建 ACP 内部会话、历史压平（票 03） |
| **兼容性** | 只支持 DSH 0.2 核心；官方「模型」页不能编辑 ACP 路由；影子选择器里第三方模型名徽标失效；`/model` 弹窗不分组 |
| **依赖风险** | `appendPluginRecord` 非稳定 API；记录形状变更需自行做版本兼容 |

### 四、需要一并订正的陈旧表述（清单，实施时逐条改）

1. `README.md:39` 上下文窗口五级回退链——保持，仍准确。
2. 「卡片只在 Chat 视图」——票 04/07 实施后**必须改为**「轨迹视图支持 ACP 工具行（仅 tool-call，plan/permission 仍只在 Chat）」。
3. 「推理等级缓存按进程代次/工作目录/模型」——已与 `resolveModel` 的惰性解析一致，保留。
4. 许可证节——按票 02 的结论改写（`Copyright (c) 2026 Oasis`，删上游派生叙事）。
5. 新增一行指向 [ADR-0001](docs/adr/0001-layered-restructure.md) 与 [目标架构图](docs/design/dsh-acp-pro-layered.architecture.json)。

### 五、执行顺序

README 重写是**最后一步**：它依赖票 01（清理完）、票 02（许可定稿）、票 04/07（轨迹与重构落地后的真实能力边界）。在 S1–S4 重构与需求 2/3 完成前，README 里关于轨迹与分层的描述只能写「计划中」，会立刻过期。**建议 README 重写与最终功能落地同批提交。**

定案：README 收敛为八节（定位/功能/架构含 mermaid/安装/配置/限制/开发链接/许可证），目标 ≤150 行；删「截图」节；「开发」节整节并入 docs/dsh-plugin-dev/README.md（不新建第二份开发入口）；「限制」节由 16 条平铺改为六组（执行模型/可观测性/用量精度/跨来源/兼容性/依赖风险）；README 重写放在最后一步，与 S1–S4 重构及需求 2/3 落地同批提交，避免描述立刻过期。

## 进度

- 进度：100%（2026-10-28T20:53:05+08:00）：定案：八节结构 ≤150 行；保留 mermaid；开发节并入 dsh-plugin-dev/README；限制节改六级分组；README 最后一步与功能落地同批提交
