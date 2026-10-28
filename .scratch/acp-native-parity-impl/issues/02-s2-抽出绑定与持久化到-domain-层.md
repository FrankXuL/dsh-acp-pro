<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-IDEMPOTENCY-KEY: deck-36e31ed5-5977312 -->
<!-- DSH-CREATED: 2026-10-28T13:22:00.918Z -->
# 02: S2 抽出绑定与持久化到 domain 层

**What to build:** Host 侧的绑定数据与持久化从 adapter 里搬出，成为可单独测试的 domain 模块。完成后「绑定是什么、怎么存、怎么读回」集中在一处，改存储格式不再牵连会话建立与回合编排。

**Blocked by:** 01（清理先完成, 避免与文档改动交错）

**Status:** resolved

- [ ] 绑定结构与持久化记录的互转集中在一个 domain 模块
- [ ] 文件存储与内存存储实现在 domain 层，adapter 不再自己拼路径或读写 JSON
- [ ] adapter 行数较上一片继续下降（只降不升）
- [ ] `tsc --noEmit` 退出码 0
- [ ] `vitest run` 全绿，且测试文件数与断言数不减少
- [ ] 分层守卫测试通过：domain 不 import surface/transport、不 import host 的 service 层、不出现宿主上下文访问

纯搬运，零逻辑改动：绑定结构与持久化记录之间的转换、文件存储实现、内存存储实现都移到 domain 层；adapter 只调用它们。

## Comments

### local — 2026-10-28T13:26:50.666Z
已执行（提交 2d1e4f8）：domain/binding.ts 承载持久化记录契约、记录校验与绑定↔记录双向转换；domain/binding-store.ts 由 service/session-store.ts 移入并复用 binding.ts 的类型与校验（删除重复的 isRecord）；adapter 的 recordOf/bindingOf 改为调用纯转换，Binding 改为 extends BindingState 只留 live 句柄。刻意保留两处原语义：记录恢复时 turnState 按 pending 有无取 unknown/idle；recovery 仍为 'new'（重连确认后才标 loaded）。adapter 1486→1442 行。门禁：tsc 0、28 文件/209 项全绿、分层守卫 5/5。




## 进度
