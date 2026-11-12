# Riverline Poker Coach — Product Demo

当前版本：T1 教学升级已完成本地 Demo 验收；原第一版本地 stub/mock Demo 已完成 D01–D08。研究、连续节点、Agent、训练、复盘、备份恢复已连通；扑克数值和推理均为明确标记的合成示例。

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

自定义输入没有配对示例时保留输入并明确未覆盖。无真实 Solver、LLM、规则引擎、支付、认证、云同步或牌桌；无需 API Key。Hero 自定义合法尺度与混合频率按用户要求暂缓，现有范围混频保留。

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

无远程、无推送、无部署；本地 Git 不代替独立备份。回看与无损恢复见 [Git 工作流](docs/git-workflow.md)。

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
