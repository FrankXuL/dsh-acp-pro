<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-e6b348b8-5977312 -->
<!-- DSH-CREATED: 2026-10-28T13:22:26.583Z -->
# 06: ACP 工具调用进入原生轨迹视图

**What to build:** 用户打开原生「轨迹」视图时，能看到 ACP 回合的工具调用行，与原生 provider 的审视方式一致。行内容诚实标注为外部 ACP 记录，不伪装成 dsh 自己发起的 tool 卡。plan 与权限仍只在 Chat 视图。

**Blocked by:** 04（S4 落定客户端结构后, 新增 Definition 才有干净位置）

**Status:** resolved

- [ ] 轨迹视图中出现 ACP 工具调用行，带标题、kind、状态、时间
- [ ] 该行明确标注为外部 ACP 记录，不与原生 tool 卡混淆
- [ ] Chat 视图原有三张卡片行为完全不变（回归通过）
- [ ] plan 与 permission 不被伪装成轨迹里的工具结果
- [ ] 新 Definition 的 kind 与现有三个不重名，注册不抛错
- [ ] 只读插件记录，不写任何原生 `tool/call` / `tool/result` 事件
- [ ] 不注册轨迹视图 builder（已由宿主注册，重复注册会抛）
- [ ] `tsc --noEmit` 退出码 0、`vitest run` 全绿

承载方式：新增一个声明目标为轨迹视图的会话 Definition，与现有三个目标为 Chat 的 Definition 并存（现有三份未声明排他，同一事件可被两条路径各自匹配）。贡献类型用引擎唯一允许外部对象的那个通道，节点用「未知表面」兜底形状。

## Comments

### local — 2026-10-28T13:49:24.197Z
已执行（提交 2c78393）：新增 conversation/trajectory-records.ts，声明 target:'trajectory' 的 Definition，把 tool-call 记录以 { kind:'node' } + unknown-surface 节点（type='acp-tool-call'）承载，诚实标注为外部 ACP 记录；信封自行内联以满足引擎校验（key 相等、target 匹配）；kind 与现有三个不重名；不注册 view builder；plan/permission 明确不进轨迹。types/dsh-client-ui-trajectory.d.ts 按仓库既有惯例本地声明该平台种子包类型。测试 9 项覆盖 target/kind 唯一性、记录认领、身份、信封、承载形状、空态与 payload 投影。门禁 tsc 0、31 文件/235 项全绿。未验证项如实记录：本票只验证了 Definition 的静态契约与构建产物，未在真实 DSH 应用内打开轨迹视图确认视觉呈现——那需要安装插件并重启桌面端。




## 进度
