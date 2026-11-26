# Riverline Poker Coach

2026-11-26 第二轮实施：动作帧驱动整手牌桌、三档节奏/跳过、图形选牌/范围、一键真实河牌研究与同解图表已落地；通过独立数值门后新增真实转牌→合法河牌分支研究（每方16组合、每街单尺寸、无再加注）。详见[第二轮交付与验收](docs/riverline-round2-delivery-2026-11-26.md)。未完成翻牌/多人均衡、全范围转牌树、真解整手评分和定向复测。当前沿用本地同端口页面/API，无新增云依赖。

2026-11-25 设计检查点：[三个仓库的学习与复用裁决](docs/riverline-round2-repository-study-2026-11-25.md)、[行动节奏 / 图形选牌 / 真实研究任务包](docs/riverline-round2-task-design-2026-11-25.md)。保留当前UI和三个主模块，先完成动作时序与图形输入，再打通真实河牌研究和图表，随后按R2-D独立验证扩展转牌。当时N00–N08与UI07–UI12均为设计，后续实施以上方第二轮交付为准；不改写下方第一轮历史证据。

2026-11-25 第一轮实施：产品目标确认，以**整手练习 → 行动前复盘 → 深入研究 → 回到练习**为主路径。已接入 PokerKit 真实规则、HU/6-max 连续整手、SQLite 保存恢复、研究来源/笔记，以及真实一般 HU 河牌树的 UI/MCP/原生查询。UI 与文字独立专项已落实到新主流程。实际范围、验证、限制与启动方法见 [第一轮交付](docs/riverline-first-round-delivery-2026-11-25.md)。转牌/翻牌、多人均衡、真解整手评分及定向复测尚未交付。

本地使用：`npm ci` → `npm run rules:setup` → `npm run solver:build` → `npm run build` → `npm start`，打开 [整手练习](http://127.0.0.1:5174/play)。需要 Node 24、Python 与固定 Rust 工具链；构建后由同一 Node 服务提供页面/API。下文旧批次按日期保留。

2026-11-25 呈现专项：[UI 设计与文字呈现优化](docs/riverline-ui-copy-optimization-task-2026-11-25.md)。新主流程的信息取舍、导航、UI 与文字已实施；全部旧课程/示例页的专项改造仍未完成。

2026-11-25 统一产品设计：[练习→复盘→研究→再训练](docs/riverline-unified-product-architecture-2026-11-25.md)、[运行时/技术栈/部署](docs/riverline-unified-runtime-deployment-2026-11-25.md)、[视觉与交互](docs/riverline-unified-experience-design-2026-11-25.md)、[开发与验收](docs/riverline-unified-implementation-plan-2026-11-25.md)。以本仓库为主底座，复用成熟规则内核和固定 Solver；第一轮已实施范围以上方交付为准，不代表 U00–U08 全部完成。

2026-11-18 历史检查点：[一般河牌树独立验证与查询基础](docs/solver/validation/r2-river-tree-2026-11-18.md) 覆盖 6 个独立数值问题与按节点分页读取。2026-11-25 已将一般树合同/作业/按需读取/恢复接入产品 UI/MCP；产品锁定/BR实验仍未开放，不能把内部基准能力等同于产品覆盖。

真实研究入口：`/solver/real`；原 `/solver` 仍是合成示例工作台。[2026-11-18 R2 交付](docs/solver/validation/r2-river-delivery-2026-11-18.md) 为原单下注受限模型的历史证据；本轮已扩展到一般 HU 河牌离散树，具体组合/资源限制见最新交付。转牌、翻牌、六人均衡、实验和教学真解消费仍待开发。

2026-11-18 R1 历史检查点：固定版本完整引擎的受限 HU 河牌通过 4 个独立数值基准，完成 Node↔Rust 进程协议与取消/中断验证。当时 UI/MCP 未接入，现已以上方 R2 交付更新。[独立验证与限制](docs/solver/validation/r1-river-2026-11-18.md)、[运行基准](benchmarks/solver/README.md)、[R2 进程边界](contracts/solver/README.md)。

2026-11-18 执行前设计入口：[R1–R3 任务包](docs/solver-real-task-design.md)、[代码库方案](docs/solver-real-codebase-design.md)、[工程规范与验证](docs/solver-real-engineering-standard.md)。复用完整 Rust 引擎，以本地进程接入现有 Node/MCP 服务，先独立验证 HU 河牌，再转牌、翻牌；翻前/六人另验。设计时尚未实施，当前状态以上方实际进展为准。

换设备/换聊天续接：[真实 Solver 开发交接（含 2026-11-18 更新）](docs/solver-real-engine-handoff-2026-11-13.md)。最新实际状态以上方 R2 记录为准；下文 S1/T1/D 系列均为历史 Mock 批次。
S1 本地 Mock 开发与自动验收已完成（2026-11-13）：[Solver 与范围](http://127.0.0.1:5173/solver) 提供 HU/六人路径、版本编辑、固定分析、实验、教学证据与恢复；UI 和真实 MCP 共用唯一本机服务。105 项状态测试、46 工具实际调用、44 条浏览器旅程及构建通过，详见 [S1 交付记录](docs/solver-s1-delivery.md)。R1–R3 真实引擎未执行。

当前版本：T1 教学升级已完成本地 Demo 验收；原第一版本地 stub/mock Demo 已完成 D01–D08。研究、连续节点、Agent、训练、复盘、备份恢复已连通；扑克数值和推理均为明确标记的合成示例。

最新设计：[S1 Solver 与范围开发任务包](docs/solver-s1-task-design.md)，配套 [产品/内容与验收](docs/solver-s1-product-content.md)、[领域合同](docs/solver-s1-contracts.md)。历史任务设计覆盖 HU、6-max 翻前范围与单挑翻后交接；SO01–SO09 的当前实现以交付记录为准，R1–R3 真实求解验证仍为后续范围。

S1 v0.3：[新增约束映射](docs/solver-s1-constraint-mapping.md)、[MCP 与本地运行时合同](docs/solver-s1-mcp-runtime.md)。设计增加实际 MCP 双入口、唯一本地业务状态、独立任务/制品仓与 SJ16–SJ21；当时为设计，现已按合同实现；新 S1 通过本机 Node 服务保存，原版旧 Demo 保留。

新增 [Solver 理解与复用方案](docs/solver-reuse-research.md)：已核对候选源码和固定版本，任务包更新 v0.2，优先复用完整引擎与薄适配；未编译、运行或引入第三方求解器。

实际范围、演示路线、截图、验证和限制见 [第一版交付记录](docs/demo-v1-delivery.md)。这是独立的新 Demo 工作区，旧项目与参考产品仅用于研究。

本轮执行：[T1 教学升级交付与演示路线](docs/teaching-t1-delivery.md)，对应 [任务设计 v0.2](docs/teaching-v2-task-design.md)。两个教学包、Hero 局部构建、证据/反例/迁移、理论知识建设与 Agent 引用、分库迁移与恢复已进入应用。目录有 24 主题/96 概念位置，正文为 36 条已定位主张，不宣称理论全文已齐全。

## 可以体验

- LP-A 翻前范围与 LP-B 近邻组合课程，低负担局部构建、条件对照、多节点片段、原预测、迁移与 24h 本地复测。
- 中英理论检索、条件匹配、固定引用、来源/草稿/核对/发布/勘误，以及调用同一命令的教学 Agent。
- 内容检查器、版本发布/停用、schema2 教学库与旧版只读迁移，完整备份恢复与语义暴露身份。
- S01–S10 加 TP01/TP02 局面库、收藏和最近记录；默认先浏览参考，无需先填写整个范围。
- 全范围矩阵、两张牌面的具体组合、Hero 聚焦，策略/权益/动作 EV/范围权重/构成示例。
- 连续行动与发牌节点、未覆盖与上游变动提示；S06 基准和两种对手假设的固定版本对照。
- 批量混频、锁定、输入权重、撤销重做、提交、版本比较和独立分支。
- 模拟求解生命周期、任务抽屉、取消、跳过等待、故障重试和质量状态；结果绑定固定输入。
- 8 条自写理论；3 条 Agent 脚本实际建立改进分支、实验报告或训练计划，支持建议模式、暂停、取消、冲突恢复。
- 全范围构建、分支补全、策略诊断、局面比较四类练习；独立/辅助记录、迁移复测与可追溯作答。
- 手牌行动前复盘、缺失字段确认、提取研究/练习；翻前、三人底池、MTT/ICM 可操作预览。
- IndexedDB 保存、JSON/Markdown 导出、校验后导入新副本、损坏原件下载、本应用重置与重播。

旧 Demo 页面中的自定义输入没有配对示例时保留输入并明确未覆盖；求解和推理仍为合成示例。真实 Solver 只按上方 `/solver/real` 已验证范围提供，不以旧六人/教学示例补足能力。没有接入真实 LLM、支付、认证、云同步或牌桌；无需 API Key。旧 Demo Hero 自定义尺度与混频仍按历史范围处理。

## 运行

使用 Node.js 24（本机验证 24.15.0），在仓库根目录执行：

```powershell
npm ci
npm run dev
```

打开 [引导课程](http://127.0.0.1:5173/learn)，或回看 [旧版研究](http://127.0.0.1:5173/library)。开发服务只监听本机；不要直接双击 index.html。

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
```

浏览器依赖只需首次安装。`npm run e2e` 可自动启动本地服务，已运行的 5173 服务须属于本仓库。`npm run preview` 在 4173 查看生产构建。T1 本轮实测：类型检查、构建、90 项状态测试与 35 条 Chromium 旅程通过，含旧版回归；具体边界见交付记录。

## Git 与恢复

当前分支 `demo/development`。原设计、D01、Hero、D02 和 v0.2 计划标签保持不变。`baseline/demo-v1-m2`、`baseline/demo-v1-m3`、`baseline/demo-v1.0` 在整版验收后共同记录最终提交，分别标记相应条件已达成。

T1 应用提交 `3503f07`；`baseline/teaching-t1-m1` 保存首个已验证教学闭环，`baseline/teaching-t1.0` 保存整轮交付。旧设计标签与第一版标签保持不动。

GitHub 私有仓库：[tyRant-yun/poker_coach](https://github.com/tyRant-yun/poker_coach)。本次归档保存所有本地分支、历史与既有基线标签，并另存源码 ZIP 和完整 Git bundle；没有部署应用。基线清单与恢复说明见 [归档记录](docs/repository-archive-2026-11-13.md) 和 [Git 工作流](docs/git-workflow.md)。

## 资料

| 文件 | 内容 |
|---|---|
| [第一版交付](docs/demo-v1-delivery.md) | 本轮成果、演示路线、F/J 覆盖、验证与局限 |
| [产品设计](docs/product-design.md) | F01–F18、J01–J09、页面与体验约定 |
| [参考研究](docs/reference-research.md) | 产品/GitHub 比较、来源与取舍 |
| [Solver 教学专题](docs/solver-teaching-research.md) | 7 组商业产品逐项功能分析与教学借鉴 |
| [教学调整方案](docs/teaching-product-redesign.md) | 新教学旅程、内容资格、DDD、评分与候选任务；尚未实施 |
| [T1 开发任务设计](docs/teaching-v2-task-design.md) | 当前设计入口、TE01–TE09、连续工作包与 TJ01–TJ13 验收 |
| [T1 产品交互](docs/teaching-v2-product-design.md) | 两个入口、页面、阶段、身份与反馈 |
| [T1 内容规格](docs/teaching-v2-content-spec.md) | 具体翻前树、金额、示意范围、题干与答案边界 |
| [T1 领域合同](docs/teaching-v2-contracts.md) | DDD、命令、暴露投影、评价、版本与新旧数据隔离 |
| [T1 理论知识库](docs/teaching-v2-knowledge-design.md) | 理论覆盖、查找/构建、主张/来源/定位、检索与教学引用；尚未建设 |
| [技术栈](docs/technology-selection.md) | 已确认技术方案与职责 |
| [模块与集成](docs/demo-architecture.md) | 领域边界、应用命令、状态、实际实现 |
| [Mock 合同](docs/mock-contracts.md) | 输入匹配、内容资产与模拟边界 |
| [任务设计](docs/demo-v1-task-design.md) | D01–D08 原合同、连续开发与验收 |
| [开发状态](docs/development-plan.md) | 实际任务状态与里程碑 |
| [评审脚本](docs/demo-review.md) | 演示、异常与实际自动化覆盖 |
| [设计决策](docs/decisions.md) | 需求、默认判断与未冻结生产决策 |
| [D01 历史](docs/d01-delivery.md) / [Hero 历史](docs/hero-feedback-delivery.md) / [D02 历史](docs/d02-delivery.md) | 保留当时交付与验证记录 |
