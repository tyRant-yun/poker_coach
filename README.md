# Riverline Poker Coach — Product Demo

当前阶段：技术栈已确认，第一版 Demo 开发任务设计待用户审阅。尚未创建可运行应用。

**开发门：用户明确要求审阅任务设计后再开始开发。当前只交付设计文档与 Git 审阅基线，不创建源码、不安装依赖、不执行 D01–D08。**

本轮审阅入口：[第一版 Demo 开发任务设计](docs/demo-v1-task-design.md)。

本仓库是独立的新 Demo 工作区，旧项目仅作为研究来源，不克隆其业务实现。

## 本轮目标

用确定性的 stub/mock 展示德州扑克范围策略构建、连续策略、模拟 Solver、策略评价、理论知识、Agent 控制、复盘及长期训练的理想完整流程。

界面编辑、版本管理、撤销、导航、本地保存等交互应真实工作；扑克求解、真实牌局裁决、对手推断、模型推理和能力预测均使用清楚标识的模拟数据。

不接入真实 Solver、LLM、支付、认证、云同步或真实牌桌；不需要 API Key。

## 工作方式

- 产品设计先于 UI 开发；完整旅程优先于孤立模块。
- 所有定量演示材料标记为示例，不宣称为已验证扑克结论。
- Git 提交保存阶段状态，具名标签保存可回到的基线。
- 当前不创建远程仓库、不推送、不部署。

## Git

主分支为 `main`。已保存 `baseline/repo-init` 和 `baseline/design-v0.1`；当前分支为 `demo/development`。本轮任务审阅稿保存为 `baseline/demo-v1-plan-v0.1`，该标签不代表开发已经获准。

回看、恢复和回滚方法见 [Git 工作流](docs/git-workflow.md)。

## 设计与开发资料

| 文件 | 内容 |
|---|---|
| [产品设计](docs/product-design.md) | 产品范围、页面、F01–F18 功能和 J01–J09 旅程 |
| [参考研究](docs/reference-research.md) | 官方产品文档、GitHub 项目比较、取舍及证据边界 |
| [已确认技术栈](docs/technology-selection.md) | 技术选择、职责、取舍与实施约束 |
| [模块与集成](docs/demo-architecture.md) | 模块决定权、端口、对象、状态、存储和技术方向 |
| [Mock 合同](docs/mock-contracts.md) | 真实交互/合成结果边界、S01–S10 场景、故障和结果匹配 |
| [第一版开发任务设计](docs/demo-v1-task-design.md) | 待审阅的 8 个任务卡、具体交付、依赖、验收、覆盖与检查点 |
| [开发计划](docs/development-plan.md) | 当前状态、D01–D08 任务、依赖与验收 |
| [演示评审](docs/demo-review.md) | 理想流程、异常恢复、视觉和完整性检查 |
| [设计决策](docs/decisions.md) | 明确需求、工作默认和留待后续验证的事项 |
| [Git 工作流](docs/git-workflow.md) | 检查点、无损回看、回滚与本地备份边界 |

本轮建议审阅顺序：第一版开发任务设计 → 已确认技术栈 → 模块与 Mock 合同 → 演示评审脚本。产品范围与旅程可回看产品设计。

任务审阅通过后才可开始开发。当前没有应用启动命令；获准后由 D01 创建脚手架并补齐实际命令。
