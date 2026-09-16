# PasteBar Harness 工程化改造计划

> **状态：待评审**（v1，2026-09-16）
> **工作分支：`harnessing`**（本文档及其后所有改造仅在该分支落地，不污染 `main`）
> 确认本计划后，按阶段 1 → 5 顺序实施；每个阶段结束单独提交、单独可评审。

---

## 1. 背景与标准

本计划以 OpenAI 工程博客《工程技术：在智能体优先的世界中利用 Codex》
（https://openai.com/zh-Hans-CN/index/harness-engineering ，下称"原文"）为项目标准。
原文的核心主张：**工程师的主要工作从"编写代码"转向"设计环境、明确意图、构建反馈回路"**，
使编码智能体（Claude Code / Codex 等）能可靠地在这个仓库里工作。

原文要点与本项目现状的映射：

| # | 原文最佳实践 | PasteBarApp 现状 | 差距 |
|---|---|---|---|
| 1 | 仓库即记录系统：知识、计划、技术债全部版本化进仓库 | 无 `docs/`；知识散落在 CLAUDE.md 和口头 | 高 |
| 2 | AGENTS.md 是 ~100 行"地图/目录"，渐进披露到 docs/ | 无 AGENTS.md；CLAUDE.md 256 行百科全书（且自述"无测试"已过时） | 高 |
| 3 | 计划是一等工件：执行计划 + 进度 + 决策日志入库 | 无任何入库计划 | 高 |
| 4 | 机械可执行：格式化/lint/类型/测试/结构约束全部可一条命令执行并进门禁 | eslint 配置存在但 **eslint 本身未安装、无 lint 脚本、任何 CI 都不会跑它**；无任何测试 | 极高 |
| 5 | 规范架构：固定分层、有限依赖边、由 linter/结构测试强制执行 | commands→services→models 分层雏形存在，但无强制；前端无分层约束 | 中 |
| 6 | 品味不变式编成"黄金原则"+lint 规则（文件行数、认知复杂度等） | sonarjs 认知复杂度阈值被设为 **200**（等于关闭）；存在 3368 行的页面组件 | 高 |
| 7 | 边界处解析数据（parse, don't validate） | 前端 invoke 返回基本未做运行时校验（zod 在依赖里但 IPC 边界未用） | 中 |
| 8 | 持续小额偿还债务（GC 循环），而非攒大重构 | 一次性大重构成本高，本计划按小步 commit 执行 | — |

**本次改造的非目标**：不改变业务功能行为（唯一例外是阶段 1 中标注为 `BUG` 的既有缺陷修复，
且逐条在问题清单中说明）；不更换技术栈（Tauri 1.x / Diesel / React 保持）；不做与 harness 无关的功能开发。

---

## 2. 仓库现状快照（本次预扫描事实，供计划评审）

- **规模**：总代码约 10.76 万行（Rust ≈ 12.6k 行 / 41 文件，TS/TSX ≈ 95k 行）；monorepo，
  前端唯一 workspace 包 `packages/pastebar-app-ui`，后端 `src-tauri`（Tauri 1.8 + Diesel/SQLite + 3 个 git/path 本地插件 libs）。
- **零测试**：`src-tauri` 无任何 `#[cfg(test)]`；前端唯一的 `*.spec.tsx` 属于 vendored 的
  react-twitter-embed（第三方拷贝），不构成项目测试。CLAUDE.md 亦自述"no test infrastructure"。
- **lint 形同虚设**：根与 UI 各有一份 `.eslintrc.js`（引用 `@typescript-eslint`、sonarjs、
  react-compiler 插件），但 **`eslint` 与 `@typescript-eslint/*` 均不在任何 package.json 依赖里**，
  无 `lint` npm script；`.eslintrc` 旧格式与 npx 拉到的 eslint v9 不兼容。项目里 `console.*` 222 处、
  `any` 113 处无人拦截。
- **CI 门禁缺位**：`.github/workflows/build-test.yml` 仅 `workflow_dispatch`（push 触发被注释掉），
  内容是 version-bump + macOS 构建，**不做 lint / typecheck / test**；另两个 workflow 是 Claude 机器人。
- **异常处理**：Rust `unwrap()/expect()` 199 处（main.rs 独占 86 处）、`println!` 152 处
  （与 CLAUDE.md 规定的 `debug_output` 模式不一致）；前端空 `catch {}` 8 处、`.catch(() => {})` 静默失败。
- **巨型文件**：`ClipboardHistoryPage.tsx` 3368 行、`ClipEditContent.tsx` 2292、`NavBar.tsx` 2064、
  `Dashboard.tsx` 1830、`main.rs` 1410、`history_service.rs` 1356、`settingsStore.ts` 1341。
- **仓库卫生**：`.env` 被 git 跟踪（含本机路径配置）；`vite.config.mts.timestamp-*.mjs` 构建产物入库；
  `tailwind-safelist.txt` 108KB 生成物入库。
- **命令面（IPC 契约）无文档**：前端 58 个不同的 `invoke('...')` 命令名 vs 后端 101 条注册命令，
  名称集合无法直接对齐（疑似存在死命令与命名漂移，**阶段 1 需精确核实**）；事件名同样无契约文档。
- **既有可复用资产**：Prettier / rustfmt / changesets / `translation-audit` 脚本 / CLAUDE.md 中的
  架构描述——这些是加固门禁的地基，不重造。

---

## 3. 阶段 1：项目全量扫描 & 风险梳理

目标：把上面的"预扫描事实"变成**穷尽的、逐条可追溯的结构化问题清单**和**带优先级的解决计划**。

### 3.1 子任务

| 子任务 | 内容 | 方法/产出 |
|---|---|---|
| 1.1 指标化静态扫描 | 固化本次扫描口径并扩展：文件行数分布、函数复杂度（sonarjs 恢复阈值后跑通得到真实分布）、`unwrap/expect/panic`、空 catch、`any`、`console.*`、TODO/FIXME、重复代码块（jscpd）、死导出 | 脚本化：`scripts/harness/scan.sh`，输出可重跑、可对比 |
| 1.2 关键路径人工深读 | 按风险排序读：剪贴板采集链（`clipboard/mod.rs`）、DB 层与迁移（`db.rs` + `migrations/`）、history/items/collections service、`main.rs` 启动与托盘、前端 store 同步与 QuickPaste 多窗口链路 | 逐条记录问题进清单 |
| 1.3 IPC 契约核实 | 生成"前端调用命令 × 后端注册命令 × 事件"三向对照表，找出：死命令、未注册却被调用（运行期才炸）、参数无类型校验的边界 | 对照表进 `docs/contracts/tauri-ipc.md`（阶段 2 正式化） |
| 1.4 异常与边界 case 审查 | 错误被吞/被 unwrap 的路径；磁盘满、DB 锁、路径含空格/非 ASCII、图片文件丢失、并发粘贴等边界 | 问题逐条入清单 |
| 1.5 依赖与安全卫生 | `npm audit --omit=dev`、`cargo` 依赖过期/重复（同包多版本）、git 跟踪卫生（.env、构建产物）、vendored libs 范围圈定 | 入清单 + 阶段 3 门禁取材 |
| 1.6 风险分级与排序 | 统一定级标准（见 3.3），分配 `BUG / DEBT / RISK / HYGIENE` 类型标签 | 解决计划 `fix-plan.md` |

### 3.2 产出物

- `docs/harness/ISSUES.md` —— 问题清单。**每条格式固定**：
  `ID | 位置(file:line 或 glob) | 类型(BUG/DEBT/RISK/HYGIENE) | 风险等级(P0-P3) | 影响范围 | 现象与依据 | 建议方案 | 所属阶段`
- `docs/harness/FIX-PLAN.md` —— 解决计划：优先级排序、修复方案、依赖项、预估改动范围（文件数/行数）、
  配套文档与测试任务编号（指向阶段 2/5 的对应条目）。
- `scripts/harness/scan.sh` —— 可重跑的扫描脚本（后续阶段用于验证收敛趋势）。

### 3.3 风险分级标准

- **P0**：可导致数据丢失/崩溃/安全问题的现有缺陷（如启动路径 unwrap panic、静默吞错的写入链）。
- **P1**：阻断可靠迭代的系统性缺口（无测试、无门禁、契约漂移）。
- **P2**：显著维护风险（巨型文件、重复逻辑、199 处 unwrap 中触达用户操作的子集）。
- **P3**：卫生类（tracked .env、构建产物入库、console.log）。

### 3.4 验收标准

- [ ] 清单中每条 P0/P1 都有 `fix-plan.md` 里对应的处理条目与阶段归属；每条标注"行为不变"或"行为变更(BUG)"。
- [ ] `scan.sh` 在本地一键可跑，两次运行输出 diff 稳定（可重复）。
- [ ] IPC 三向对照表完成，死命令/漂移命令逐条确认（不允许"疑似"进入阶段 4）。
- [ ] 文档提交为一个独立 commit，可单独评审。

---

## 4. 阶段 2：文档体系重构，对齐项目现状

目标：按原文"AGENTS.md 当目录、docs/ 当记录系统"重建文档，实现智能体/新人的**渐进披露**。

### 4.1 子任务

| 子任务 | 内容 |
|---|---|
| 2.1 建 `docs/` 骨架 | `docs/README.md`（目录+每篇一句话+状态）；`docs/architecture.md`；`docs/modules/`；`docs/contracts/`；`docs/reference/`（构建、发布、迁移等既有指南归位） |
| 2.2 写 `AGENTS.md`（≈100 行） | 地图而非手册：项目一句话、技术栈、目录地图、命令速查（dev/build/test/lint）、分层规则摘要、"去哪看深层文档"索引、禁止事项。CLAUDE.md 收敛为指向 AGENTS.md 的薄壳，消除双份漂移 |
| 2.3 后端模块文档 | `docs/modules/backend-*.md`：commands 层、services 层（history/items/collections/request/link_metadata）、clipboard 采集链、db.rs 与路径变换约定（`{{base_folder}}`）、menu/多窗口/事件流；每篇含**职责边界、输入输出、异常定义、已知限制** |
| 2.4 前端模块文档 | `docs/modules/frontend-*.md`：多入口（main/history/quickpaste）、store 清单与同步机制、`lib/commands.ts` invoke 封装约定、i18n、vendored libs 豁免说明 |
| 2.5 IPC 契约文档 | `docs/contracts/tauri-ipc.md`：全部命令与事件的**请求/响应 shape、错误字符串约定、调用方**；由脚本从代码生成初稿（阶段 3 做漂移门禁），人工补语义 |
| 2.6 架构图 | mermaid：模块依赖图（commands→services→models/db 分层图、前端 store↔页面、多窗口事件流），入 `docs/architecture.md` |
| 2.7 过时文档清理 | CLAUDE.md 中"无测试"等表述随阶段 5 更新；`WHATS_NEW_0.7.0.md`、`BUILD_GUIDE_ARM64_WINDOWS.md` 移入 `docs/reference/` 并加"最后核对日期"；`docs/harness/GOLDEN-RULES.md`（黄金原则，阶段 3/4 lint 规则的依据文档） |

### 4.2 产出物

`docs/` 全量目录 + `AGENTS.md` + 更新后的 `CLAUDE.md`/`README.md` 链接 + `scripts/harness/gen-ipc-contract.mjs`（契约生成脚本雏形）。

### 4.3 验收标准

- [ ] 新任务提示一个智能体"只读 AGENTS.md"，能答对：构建命令、测试命令、分层规则、IPC 契约在哪。
- [ ] 文档中的每条命令（build/lint/test/migrate）实际执行一遍成功；每条 file:line 引用经脚本抽查有效。
- [ ] IPC 契约覆盖 100% 注册命令（生成脚本 + 人工复核）。
- [ ] 无"死文档"：`docs/` 内每个文件被 `docs/README.md` 或 AGENTS.md 链接；无指向不存在文件的链接（`scripts/harness/docs-lint.sh` 检查）。

---

## 5. 阶段 3：CI / 提交门禁审计与加固

目标：每次提交/PR 都机械校验 **可构建、可类型检查、lint 通过、测试通过、契约与文档不漂移**；
本地有等价的单入口脚本（对齐原文"agent 能自己跑门禁"）。

### 5.1 现状审计结论（已由预扫描得出，写入 `docs/harness/gates.md` 时补细节）

- 无任何 push/PR 触发门禁；eslint 装不上跑不了；无 typecheck script；Rust 无 fmt/clippy 门禁；
  `translation-audit`、changesets 存在但 CI 不把关；`.env`/构建产物被跟踪说明无 hygiene 检查。

### 5.2 子任务

| 子任务 | 门禁 | 实现 | 分级策略 |
|---|---|---|---|
| 3.1 修 TS lint | `npm run lint` | 补装 `eslint@8 + @typescript-eslint` 等缺失依赖，保留 `.eslintrc` 格式（升级 v9 flat 记为后续项）；认知复杂度阈值 200→**40（初期基线）** | 先 error 级仅新增违规（基线豁免文件），阶段 4 逐步收紧 |
| 3.2 类型门禁 | `npm run typecheck` | `tsc --noEmit`（根 + UI 包），UI 包补 script | 直接 fail |
| 3.3 格式门禁 | `npm run format:check` | `prettier --check` + `cargo fmt --check` | 直接 fail |
| 3.4 Rust 静态门禁 | `cargo clippy -- -D warnings` | 基线：`clippy.toml` + `#[allow]` 清单入 `docs/harness/DEBT-BASELINE.md`，逐里程碑删 allow | 从 warn 计数阈值过渡到 `-D warnings` |
| 3.5 测试门禁 | `npm test` / `cargo test` | 阶段 5 的 vitest + cargo test 接入 CI（macOS + ubuntu 双 runner 冒烟） | 直接 fail |
| 3.6 契约漂移门禁 | `scripts/harness/check-ipc-drift.mjs` | 前端 invoke 命令集合 ⊆ 后端注册集合，且均在 `docs/contracts/tauri-ipc.md` 有条目，否则 CI 失败 | 直接 fail |
| 3.7 文档新鲜度门禁 | `scripts/harness/docs-lint.sh` | 链接有效性 + `docs/` 内"最后核对日期"超 90 天告警（对齐原文 doc-gardening，人工版） | warn→fail |
| 3.8 仓库卫生门禁 | hygiene job | `git ls-files` 拒绝匹配 `.env`/`*.timestamp-*`/`node_modules` 等模式 | 直接 fail |
| 3.9 依赖审计 | `npm run audit:prod`、`cargo audit`（可选，需 runner 装 cargo-audit） | 每周定时 workflow（不阻塞 PR，对齐"小门禁快、大扫描定时"） | 定时报 issue |
| 3.10 workflow 重构 | `.github/workflows/quality.yml` | PR/push 触发上述 3.1–3.8；`build-test.yml` 的 push 注释解除并拆分职责（version-bump 归 release.yml） | — |
| 3.11 本地等价 | `scripts/harness/check-all.sh` | 单入口串起所有门禁，AGENTS.md 首推此命令 | — |

### 5.3 产出物

`quality.yml` / 更新的 `build-test.yml` / `scripts/harness/*` / 根与 UI `package.json` 脚本与 devDeps /
`docs/harness/gates.md`（每个门禁：目的、命令、失败处理、基线豁免清单）。

### 5.4 验收标准

- [ ] 在 harnessing 分支开一个 PR（或 push），quality.yml 全绿；故意引入 1 个类型错误、1 个未注册 invoke、
      1 个 `.env` 类文件，三个门禁分别红。
- [ ] `bash scripts/harness/check-all.sh` 本地一键跑通全部门禁（与 CI 同集合）。
- [ ] 基线豁免文件有显式清单和删除计划，不允许无限期豁免。
- [ ] CI 时长 ≤ 15 分钟（不含 tauri bundle 构建 job）。

### 5.5 附带的仓库卫生修复（行为不变，属 HYGIENE）

`.env` 与 `vite.config.mts.timestamp-*.mjs` 从 git 移除跟踪（**本地文件保留**，`.env.sample` 补全字段说明），
`.gitignore` 增补模式。此条为 P0 级安全卫生项，在本阶段执行（理由：卫生门禁 3.8 需要它先通过）。

---

## 6. 阶段 4：代码重构 + 问题落地修复

目标：执行 `FIX-PLAN.md`，遵循四条重构原则（单一职责、控复杂度、提炼公共逻辑、文档同步）。
**行为不变是硬约束**；仅清单中标注 `BUG` 的条目允许行为修正。

### 6.1 执行原则

1. **测试先行缺口处理**：阶段 5 完整测试体系落地前，用"契约冻结"保安全——重构前先为受影响
   IPC 命令补 `docs/contracts` 条目 + 冒烟测试骨架（阶段 5 的 5.2 提前铺最小子集）。
2. **每波一次评审**，每个子任务一个 commit（见 §8），禁止跨波混提交。
3. 每波结束跑 `check-all.sh` + 手动冒烟清单（`docs/harness/smoke-checklist.md`：启动、复制→历史、
   粘贴、QuickPaste、托盘菜单、集合增删改、备份恢复、图片路径变换）。

### 6.2 重构波次（按 FIX-PLAN 优先级实例化，以下为当前预判）

| 波次 | 内容 | 预估范围 |
|---|---|---|
| W1 后端异常与日志统一 | `main.rs` 86 处 unwrap 中启动路径改为带错误弹窗/日志的 fail-safe；152 处 `println!` 收敛到 `debug_output`/tauri-plugin-log；定义统一错误类型（沿用 anyhow + 命令层 `Result<_, String>` 边界转换，**不改前端可见错误格式**） | main.rs、clipboard、db、menu |
| W2 IPC 边界 typed 化 | 后端命令注册表收敛为单一来源（消除 101 条手写列表漂移）；前端 `lib/commands.ts` 升级为带 zod schema 的类型化封装，逐模块迁移调用点（先 history/items，后其余）；死命令按清单删除（标 BUG/DEBT 说明） | 前端 58 处 invoke + 后端 mod.rs |
| W3 后端巨型文件拆分 | `main.rs`(1410) → 启动/tray/hotkey/window 分模块；`history_service.rs`(1356) → CRUD/查询/清理/脱敏分离；`clipboard_commands.rs`(795)、`link_metadata_commands.rs`(605) 同法；纯移动不改逻辑 | src-tauri 约 8 文件 |
| W4 前端巨型组件拆分 | `ClipboardHistoryPage.tsx`(3368)、`ClipEditContent`、`NavBar`、`Dashboard`、`settingsStore.ts`(1341)：提取自定义 hooks 与子组件，store 按域拆分；认知复杂度阈值随拆分逐文件从基线豁免中移除 | ui 包约 10 文件 |
| W5 重复逻辑提炼 | scan（jscpd）识别的重复块：格式化转换器、copy/paste 操作 hooks、路径处理等收敛到 `lib/`；阈值：单重复块 ≥ 3 处或 ≥ 30 行 | 跨模块 |
| W6 复杂度棘轮收紧 | sonarjs 阈值 40→25；`cargo clippy` 摘 allow 清单；文件行数 lint 规则（新增文件 >500 行告警）生效 | 配置 |

### 6.3 BUG 类修复范围

仅限阶段 1 清单中标 `BUG` 且风险 ≥ P1 的条目，每条独立 commit，message 带 ISSUE-ID，
在 `ISSUES.md` 里回写"已修复 + 修复 commit"。重构中"顺手"发现的新缺陷：入清单、下波处理，不夹带。

### 6.4 产出物

代码改动 + 每波对应的文档更新（`docs/modules/*`、契约表重生成）+ `ISSUES.md` 状态回写 +
`docs/harness/DECISIONS.md`（重大取舍：如 typed invoke 封装的分层决定）。

### 6.5 验收标准

- [ ] 每波：`check-all.sh` 全绿 + 冒烟清单 8 项人工通过 + 契约 diff 为空（除声明的 BUG 修复）。
- [ ] 完成后：>1000 行的源文件数 = 0（vendored libs 除外）；`unwrap()` 计数较基线下降 ≥ 50%；
      FIX-PLAN 中 P0/P1 条目关闭率 100%。
- [ ] `git log` 可逐 commit 追溯（§8 规范），任一 commit 可单独 revert 不破坏构建。

---

## 7. 阶段 5：补全测试体系

目标：建成**可自动化、进门禁、有覆盖率棘轮**的测试金字塔。

### 7.1 子任务

| 子任务 | 内容 |
|---|---|
| 5.1 前端单测基建 | `vitest + @testing-library/react + jsdom` 进 UI 包；`npm run test:unit`；mock Tauri `invoke`（基于 5.2 的 typed 层做假实现，天然可 mock）；配置豁免 vendored libs |
| 5.2 IPC 层假后端 | 内存版 Tauri command 处理器（按 `docs/contracts/tauri-ipc.md` schema 校验请求/响应），所有前端 store/hooks 测试跑在其上 |
| 5.3 后端单测 | `cargo test`：services 层纯逻辑（脱敏、路径变换 `{{base_folder}}`、时间清理、格式转换、语言检测）+ 基于 SQLite in-memory 跑 Diesel 查询（migration 用真实 `migrations/`） |
| 5.4 边界与异常用例 | 对阶段 1 清单每条 P0/P1：至少 1 正例 + 1 边界 + 1 异常（空 DB、超长文本、非 ASCII 路径、并发写入、损坏图片引用、脱敏正则回溯） |
| 5.5 回归/冒烟测试 | `quickcheck`/proptest 覆盖路径变换往返、格式转换往返（json↔yaml↔csv 等纯函数） |
| 5.6 覆盖率棘轮 | `vitest --coverage` + `cargo-tllvm` 太重，改用：前端 istanbul 覆盖率入基线文件；后端仅对 `services/` 出报告。CI 门禁 `coverage >= 基线值`，基线只许上调；目标：阶段 5 结束 前端 lib/store/hooks ≥50%、后端 services ≥60%，重构波及文件 ≥80% |
| 5.7 门禁接入 | 阶段 3 的 `test` job 由"骨架"转为全量；`npm test` 与 `cargo test` 均为 PR 必过；测试文件命名与目录约定入 GOLDEN-RULES |

### 7.2 产出物

vitest/cargo 测试配置、≥ 每模块 1 个测试文件、`docs/testing.md`（怎么写、怎么跑、mock 约定）、
覆盖率基线文件、CI 集成。

### 7.3 验收标准

- [ ] `check-all.sh` 含全部测试且本地/CI 结果一致（无 flaky 首跑）。
- [ ] 破坏性验证：随机挑 3 个已修 BUG 回滚其修复代码，对应测试必红（防"恒绿假测试"）。
- [ ] 覆盖率达 5.6 的初始目标；棘轮机制经 PR 验证（低于基线的 PR 被挂）。
- [ ] 新增/修改代码 100% 有对应测试条目（对照 FIX-PLAN 的"配套测试任务"列逐项勾销）。

---

## 8. 提交与评审协议（贯穿全阶段）

1. **颗粒度**：一个 commit 只做一件事。约定前缀：`scan:` `docs:` `ci:` `refactor:` `fix:` `test:` `chore:` `harness(meta):`。
2. **message**：标题 ≤72 字符写"做了什么"，正文写"为什么 + 关联 ISSUE-ID + 行为是否变更"。
   例：`refactor(main): split tray setup out of main.rs [ISSUE-012, behavior-preserving]`。
3. **追溯性**：`git log main..harnessing` 即完整改造流水账；每阶段最后一个 commit 为该阶段小结
   （`docs(harness): phase-N summary`，含验收清单勾选结果）。
4. **评审点**：阶段 1 清单与解决计划 / 阶段 2 文档骨架 / 阶段 3 门禁红绿样例 / 阶段 4 每波 /
   阶段 5 覆盖率报告与破坏性验证——共 ≥8 个独立评审点。
5. **changeset**：涉及用户可见行为（仅 BUG 修复类）的 commit 附 `.changeset/*.md`，与既有发布流程对齐。
6. **回滚**：任一阶段评审不通过，`git revert` 该阶段 commit 区间即可，主干 `main` 全程零改动。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 大文件拆分引入行为漂移 | 每波冒烟清单 + 契约 diff + 可独立 revert 的小 commit |
| eslint 补装后存量违规爆炸导致门禁瘫痪 | 基线豁免清单（逐文件），阈值棘轮收紧，不追求一步到位 |
| `cargo clippy -D warnings` 存量报错过多 | 3.4 的 warn 计数阈值过渡 |
| macOS 专属代码（tray/ax）CI 覆盖不了 | quality.yml 用 macos-latest 跑 test job；重活放定时 workflow |
| 阶段 4/5 互相依赖（无测试不敢重构） | W1/W2 先铺最小子集（5.2 假后端 + 契约测试），再进大拆分 |
| 工作量失控 | 各波预估进 FIX-PLAN，超预算 50% 触发范围重评审而非硬撑 |

---

## 10. 待确认决策点（评审本文档时请一并拍板）

1. **`.env` 解除跟踪**（§5.5）：属行为无关的安全修复，默认执行；若你依赖 fork 同步该文件请告知。
2. **ESLint 版本**：默认锁 v8 沿用 `.eslintrc`（最小改动先让门禁活起来），flat config 迁移列为阶段 6 之后可选项。
3. **是否加 git pre-commit hook**：默认不加（CI + `check-all.sh` 已闭环，hook 增加本机摩擦）；如要 husky/lint-staged 请指出。
4. **e2e 范围**：默认不做重量级 e2e（tauri 窗口自动化成本高），以"typed 假后端 + 契约测试 + 人工冒烟清单"替代。
5. **重构深度**：阶段 4 W3/W4 对 4 个巨型前端文件的拆分止于"组件/hook 提取、不改渲染行为"，不引入新状态库。

---

## 附：阶段产出物目录规划（全部入库）

```
docs/
├── README.md              # 目录（阶段2）
├── architecture.md        # 架构图+分层（阶段2）
├── modules/               # 模块文档（阶段2）
├── contracts/tauri-ipc.md # IPC 契约（阶段2/3）
├── reference/             # 既有指南迁移（阶段2）
├── testing.md             # 测试指南（阶段5）
└── harness/
    ├── HARNESS_PLAN.md    # 本文档
    ├── ISSUES.md          # 阶段1 问题清单
    ├── FIX-PLAN.md        # 阶段1 解决计划
    ├── GOLDEN-RULES.md    # 黄金原则（阶段2起）
    ├── DEBT-BASELINE.md   # 各门禁基线豁免（阶段3）
    ├── gates.md           # 门禁说明（阶段3）
    ├── DECISIONS.md       # 决策日志（阶段4）
    └── smoke-checklist.md # 冒烟清单（阶段4）
scripts/harness/           # scan/check-ipc-drift/docs-lint/check-all 等（阶段1/3）
```
