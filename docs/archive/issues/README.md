# 已归档的 Issue 档案

全部票已关闭、不再有工作要做的特征目录，从 `.scratch/` 移到这里。

## 归档规则

- 一个目录里的**所有**票都关闭后，才可移入本目录（仍有 open / claimed 票的目录留在 `.scratch/`）。
- 目录结构与 `.scratch/` 一致：`<feature-slug>/{map.md,spec.md,issues/NN-*.md}`。
- 归档时修一次相对链接：票里的 `../../docs/...` 会因为深度变化失效，需按实际层级重算。
- 若链接目标本身已被删除（例如一次性调研笔记在 2026-10-28 清理时移除），在原链接后标注「（调研笔记已于 … 删除）」，不要静默删掉这条引用——它记录了当时的决策依据。
- 归档不改票的 `Status:` 行。`closed` / `resolved` 是真实状态，归档只是位置变化。

## 当前内容

| 目录 | 票数 | 主题 |
| --- | --- | --- |
| `acp-native-parity-impl/` | 8 | 分层重构 S1–S4 + 跨来源告知 + 轨迹工具行 + 用量标注 + README 收口 |
| `acp-session-lifecycle/` | 1 | ACP 进程膨胀（65 / 193 进程、MCP 乘法放大） |
| `model-picker-popup-stacking/` | 1 | 模型选择器弹层被 composer stacking context 裁剪 |
| `model-picker-source-tabs/` | 7 | 来源 tab 探索地图（wayfinder） |
| `model-picker-ui/` | 6 | 模型选择器规格与实施票 |

仍在 `.scratch/` 的：`acp-native-parity/`（wayfinder 地图与规格，2026-10-28 刚收口）。
