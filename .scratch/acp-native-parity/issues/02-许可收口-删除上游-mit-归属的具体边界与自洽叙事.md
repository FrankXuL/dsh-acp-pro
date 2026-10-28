<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-044d4586-5977296 -->
<!-- DSH-CREATED: 2026-10-28T12:02:14.761Z -->
<!-- DSH-ASSIGNEES: lead -->
# 02: 许可收口：删除上游 MIT 归属的具体边界与自洽叙事

Type: grilling

Status: resolved

## Question

按用户决定「直接删除上游 MIT 归属」，具体删哪些行、`LICENSE` 与 `NOTICE` 各承担什么职责、删除后仓库的许可叙事怎么写才自洽且不误导？

## Answer

### 一、先把事实钉死（这是本票的前提，不是意见）

1. `LICENSE` 是标准 MIT 全文，版权行为 `Copyright (c) 2026 Fleey`。
2. `NOTICE` 第 1–9 行自认：「This project **incorporates code derived from** the deepseek-harness-acp project」，并列出 upstream repository / package / author / copyright / license 五要素。
3. `NOTICE` 第 11 行还写着：「The upstream MIT license and copyright notice are **retained verbatim in [LICENSE]**」。**这句话是本仓库自己的书面自认**，证明上游版权声明此前并非多余致谢，而是为履行 MIT 第 1 条义务（"The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."）而存在。
4. **无法在本机量化派生范围**：本仓无 `vendor/` 副本，`node_modules` 内也无 `dsh-tauri-acp` / `deepseek-harness-acp` 包；git 历史是 2026-10-26 起的新起点（`1be1836 feat: ACP agent integration for DeepSeek Harness`），首个提交即整合态。**结论：无法在本地逐文件比对量化「仍有派生代码的文件数」** —— 这是执行删除前必须承认的证据缺口。

### 二、删除边界（按用户决定执行，但边界要写准）

| 对象 | 处理 | 说明 |
| --- | --- | --- |
| `LICENSE` 的 `Copyright (c) 2026 Fleey` 行 | **删除** | 用户明确要求移除上游归属 |
| `LICENSE` 的 MIT 正文 | **保留** | 本仓库自身仍以 MIT 发布（`package.json:6` `"license": "MIT"`） |
| `LICENSE` 版权行替换为 | `Copyright (c) 2026 Oasis` | 取 `package.json` 的 `author` 值，作为唯一权威来源 |
| `NOTICE` 的「incorporates code derived from…」段（1–16 行） | **删除** | 与 LICENSE 同步移除上游派生叙事 |
| `NOTICE` 的「Third-party components」段 | **保留** | `@agentclientprotocol/sdk`(Apache-2.0)、`@deepseek-ai/*` peers 与上游无关，仍需披露 |
| `NOTICE` 的「Provider marks」段 | **保留** | MonoCode 图标是独立第三方（MIT, Nick），与 Fleey 上游无关 |
| `NOTICE` 的「Maintenance note」段 | **保留** | 说明 `appendPluginRecord` 非稳定 API，是真实的兼容性风险披露 |

### 三、必须同步订正的三处自相矛盾（否则仓库一边删一边还写着「必须保留」）

1. `README.md:291` 「许可证」节：需删掉「保留了 Fleey 版权声明」的表述。
2. `docs/dsh-plugin-dev/07-safety-compatibility.md:36-41`：现文明写「Keep `LICENSE` (verbatim upstream MIT text, Copyright (c) 2026 Fleey) and `NOTICE` … intact. **Do not remove or edit the copyright/attribution.**」—— 与本次决定直接冲突，必须改写为新的许可叙事。
3. `skills/engineering/dsh-plugin/SKILL.md:148`：「this repo integrates MIT code from `Fleey/deepseek-harness-acp`」需同步改写或删除。

### 四、`author` 不一致的订正（顺手事实修正）

- `package.json` 的 `author` 是 **Oasis**，`homepage`/`repository` 是 `FrankXuL/dsh-acp-pro`，而 `NOTICE` 与 `README` 里的版权人是 **Fleey**（那是上游作者）。
- 定案：本仓版权人统一为 **Oasis**（取 `package.json`），仓库 URL 统一为 `FrankXuL/dsh-acp-pro`。

### 五、风险登记（必须随执行一起留下记录，不能静默）

**已执行的风险**：本仓库在无上游副本可比对的情况下移除上游 MIT 版权声明。若最终发布物中仍含实质派生代码，则该部分代码的分发许可依据存在瑕疵。

**建议的缓解（不改用户决定，只留后路）**：在 git 历史中保留本次删除前的 `NOTICE` 与 `LICENSE` 版本（当前 commit `7f2fd59` 即含完整归属），使「删除」可逆且可追溯。此缓解不需要在文件里保留归属文本，因此不违背用户决定。

定案：LICENSE 保留 MIT 正文、版权行换为 Copyright (c) 2026 Oasis（取 package.json author）；NOTICE 删上游派生段、保留第三方组件/Provider marks/Maintenance note；README:291、docs/dsh-plugin-dev/07:36-41、skills/engineering/dsh-plugin/SKILL.md:148 三处同步改写；风险（无上游副本可比对、派生范围未量化）显式登记，以 git 历史保留删除前版本作为可逆缓解。

## Comments

### local — 2026-10-28T13:05:46.149Z
已按用户明确指示「忽略许可风险直接删除」执行完毕（2026-10-28）：

**已改文件**
- `LICENSE:3`：`Copyright (c) 2026 Fleey` → `Copyright (c) 2026 Oasis`（MIT 正文保留）。
- `NOTICE`：删除 1–19 行全部上游派生段（incorporates code derived from…、upstream repo/package/author、retained verbatim in LICENSE、git history 说明）；保留 Third-party components、Maintenance note、Provider marks 三段。
- `README.md:289` 许可证节：改为「以 MIT 发布，Copyright (c) 2026 Oasis；第三方组件许可与商标见 NOTICE」，删去 Fleey 归属表述。
- `docs/dsh-plugin-dev/07-safety-compatibility.md:34-41`：原「Keep LICENSE (verbatim upstream MIT text, Copyright (c) 2026 Fleey)… Do not remove or edit」改写为新的 MIT + 第三方组件口径。
- `skills/engineering/dsh-plugin/SKILL.md:148-149`：原「this repo integrates MIT code from Fleey/deepseek-harness-acp — keep attribution intact」改写为「MIT (see LICENSE); keep NOTICE accurate for third-party components」。
- `NOTICE` Provider marks 段顺手订正一处事实错误：原文指向不存在的 `src/assets/providers/*.svg`（该路径在仓库中不存在），改为 `inlined into src/client/assets/provider-icons.ts`。

**残留检查**：全仓（排除 node_modules/dist/.git/.scratch）再无 `Fleey` / `deepseek-harness-acp` / `dsh-tauri-acp` 的派生归属表述。两处剩余命中均为历史事实陈述而非许可声明：`docs/design/current-architecture-audit-2026-10.md:15`（审计当时的事实记录）与 `docs/dsh-verification-results.md:25`（记录承载 profile 里装的是另一个插件 `dsh-tauri-acp`），按「不改写历史审计证据」原则保留。

**门禁**：`tsc --noEmit` 退出码 0；`vitest run` 27 文件 / 204 项全绿。

**风险状态（按用户决定执行，不作隐瞒）**：本仓库在未能量化派生范围的前提下移除了上游 MIT 版权声明。若发布物中仍含实质派生代码，该部分的分发许可依据存在瑕疵。可逆性：删除前的完整归属保存在 git 历史（`7f2fd59` 及更早）。

## 进度

- 进度：100%（2026-10-28T20:12:07+08:00）：边界已定：LICENSE 换 Oasis 版权行、NOTICE 删派生段留第三方段、三处自相矛盾同步改、风险登记与 git 可逆缓解
