# Riverline Poker Coach — Product Demo

当前阶段：用户已授权第一轮开发，D01 首个纵向闭环已实现。D02–D08 尚未实施，当前并非整版全功能 Demo。

本轮交付：[D01 验收与演示说明](docs/d01-delivery.md)。任务范围仍以 [第一版开发任务设计](docs/demo-v1-task-design.md) 为准。

本仓库是独立的新 Demo 工作区，旧项目仅作为研究来源，不克隆其业务实现。

## 当前可以体验

- 工作台与局面库，创建 S01：BTN vs BB 翻牌研究。
- 13×13 范围矩阵、公共牌冲突排除、具体组合和牌类混频编辑。
- 明确补全剩余组合、结构校验、提交固定版本、继续编辑和恢复历史草稿。
- 运行本地模拟、查看合成参考差异、报告来源与条件；自定义输入未覆盖时不套用其他结果。
- IndexedDB 保存与刷新恢复，存储不可用时保留内存操作，导出 JSON 备份。

当前没有批量刷选/锁定/撤销重做、完整 Solver 配置、Agent、训练或复盘；这些属于 D02–D08。

## 运行

使用 Node.js 24（本机验证为 24.15.0），在仓库根目录执行：

```powershell
npm ci
npm run dev
```

打开 [本地演示](http://127.0.0.1:5173)。开发服务仅监听本机；不直接双击 index.html。

检查与构建：

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
```

浏览器依赖只需首次安装。`npm run e2e` 可自动启动本地服务；运行中的 5173 服务必须属于本仓库。`npm run preview` 在 4173 查看生产构建。

## 整版目标

用确定性的 stub/mock 展示德州扑克范围策略构建、连续策略、模拟 Solver、策略评价、理论知识、Agent 控制、复盘及长期训练的理想完整流程。

界面编辑、版本管理、撤销、导航、本地保存等交互应真实工作；扑克求解、真实牌局裁决、对手推断、模型推理和能力预测均使用清楚标识的模拟数据。

不接入真实 Solver、LLM、支付、认证、云同步或真实牌桌；不需要 API Key。

## 工作方式

- 产品设计先于 UI 开发；完整旅程优先于孤立模块。
- 所有定量演示材料标记为示例，不宣称为已验证扑克结论。
- Git 提交保存阶段状态，具名标签保存可回到的基线。
- 当前不创建远程仓库、不推送、不部署。

## Git

主分支为 `main`；当前分支为 `demo/development`。已保存 `baseline/repo-init`、`baseline/design-v0.1` 和任务审阅稿 `baseline/demo-v1-plan-v0.1`。用户随后授权第一轮开发，D01 验证完成后保存为 `baseline/demo-v1-m1`，原标签保持不变。

回看、恢复和回滚方法见 [Git 工作流](docs/git-workflow.md)。

## 设计与开发资料

| 文件 | 内容 |
|---|---|
| [产品设计](docs/product-design.md) | 产品范围、页面、F01–F18 功能和 J01–J09 旅程 |
| [参考研究](docs/reference-research.md) | 官方产品文档、GitHub 项目比较、取舍及证据边界 |
| [已确认技术栈](docs/technology-selection.md) | 技术选择、职责、取舍与实施约束 |
| [模块与集成](docs/demo-architecture.md) | 模块决定权、端口、对象、状态、存储和技术方向 |
| [Mock 合同](docs/mock-contracts.md) | 真实交互/合成结果边界、S01–S10 场景、故障和结果匹配 |
| [第一版开发任务设计](docs/demo-v1-task-design.md) | 8 个任务卡、具体交付、依赖、验收、覆盖与检查点 |
| [D01 交付记录](docs/d01-delivery.md) | 实际实现、运行方式、验收结果、截图与后续范围 |
| [开发计划](docs/development-plan.md) | 当前状态、D01–D08 任务、依赖与验收 |
| [演示评审](docs/demo-review.md) | 理想流程、异常恢复、视觉和完整性检查 |
| [设计决策](docs/decisions.md) | 明确需求、工作默认和留待后续验证的事项 |
| [Git 工作流](docs/git-workflow.md) | 检查点、无损回看、回滚与本地备份边界 |

当前建议阅读：D01 交付记录 → 实际演示 → 第一版开发任务设计。整版评审脚本仍为后续完整验收目标，不能把 D01 验收当作整版完成。
