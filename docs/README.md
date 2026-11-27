# Riverline 文档

当前文档按2026-11-27的实际实现和三仓库结构整合。能力变化先更新对应入口，批次完成后再增加带日期的验收记录；不向README或AGENTS反复追加历轮状态。

| 要解决的问题 | 当前入口 |
| --- | --- |
| 已实现什么、支持边界 | [当前状态](current-status.md) |
| 安装、启动、练习到研究怎么用 | [运行与使用](running.md) |
| 项目职责、状态和合同归谁 | [架构](architecture.md) |
| 下一步做什么、哪些旧任务仍未完成 | [开发计划](development-plan.md) |
| 翻前数据、EV原点、来源 | [数据来源](data-sources.md) |
| 旧Poker Agent哪些可采用 | [采用分析](poker-agent-adoption.md) |
| 哪些测试实际运行过 | [验证证据](validation.md) |
| 分支、版本、组件升级和恢复 | [Git协作](git-workflow.md) |
| 旧方案、交付、截图和历史指令 | [历史归档](archive/README.md) |

[合同入口](../contracts/solver/README.md)和[数值基准入口](../benchmarks/solver/README.md)保留在代码旁。`solver/validation/`的JSON是小型数值证据，`architecture/`保存旧项目静态审计；它们不替代当前状态文档。
