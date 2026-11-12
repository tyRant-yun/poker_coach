# Riverline Poker Coach — Product Demo

当前阶段：产品设计、参考研究和 Demo 开发准备。尚未创建可运行应用。

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

主分支为 `main`。首次仓库基线为 `baseline/repo-init`；设计完成后建立 `baseline/design-v0.1`，然后准备 `demo/development` 分支。

回看、恢复和回滚方法见 [Git 工作流](docs/git-workflow.md)。

## 设计与开发资料

| 文件 | 内容 |
|---|---|
| [产品设计](docs/product-design.md) | 产品范围、页面、F01–F18 功能和 J01–J09 旅程 |
| [参考研究](docs/reference-research.md) | 官方产品文档、GitHub 项目比较、取舍及证据边界 |
| [模块与集成](docs/demo-architecture.md) | 模块决定权、端口、对象、状态、存储和技术方向 |
| [Mock 合同](docs/mock-contracts.md) | 真实交互/合成结果边界、S01–S10 场景、故障和结果匹配 |
| [开发计划](docs/development-plan.md) | 当前状态、D01–D08 任务、依赖与验收 |
| [演示评审](docs/demo-review.md) | 理想流程、异常恢复、视觉和完整性检查 |
| [设计决策](docs/decisions.md) | 明确需求、工作默认和留待后续验证的事项 |
| [Git 工作流](docs/git-workflow.md) | 检查点、无损回看、回滚与本地备份边界 |

建议阅读顺序：产品设计 → 参考研究 → 模块与 Mock 合同 → 开发计划。

设计基线不代表用户已经验收，后续交互评审可以修订。当前没有应用启动命令；D01 创建脚手架后补齐真实命令。
