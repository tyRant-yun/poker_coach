# Riverline Poker Coach

Riverline 是本地德州扑克练习、复盘与研究产品。完成一手后自动展示已覆盖决定的分析、行动EV图和建议，可进入同一固定解研究，再返回原决定。

当前为2026-11-27工程基线。真实规则和受限HU求解已接入；可信100BB翻前评分、贯穿四街的自动范围链、整手EV损失与真实LLM仍未完成。[当前能力与限制](docs/current-status.md)

## 三个项目

| 仓库 | 职责 |
| --- | --- |
| [poker_coach](https://github.com/tyRant-yun/poker_coach) | 总产品、规则/数据权威、练习/复盘/研究、教学 |
| [riverline-bot](https://github.com/tyRant-yun/riverline-bot) | Bot策略、运行时、离线评估与适配 |
| [riverline-solver](https://github.com/tyRant-yun/riverline-solver) | 真实引擎、协议、原生查询与独立数值验证 |

产品通过[组件锁](components.lock.json)消费固定兼容快照。相关源码在对应组件仓库开发，验证后按固定提交升级产品。

## 启动

需要Node24、Python和Rust1.85.1；Windows还需MSVC C++构建工具。首次安装在仓库根目录执行：

```powershell
npm ci
npm run rules:setup
npm run solver:build
npm run build
npm start
```

打开[整手练习](http://127.0.0.1:5174/play)。可选HU Bot需要相邻克隆 `riverline-bot` 并执行 `npm run bot:setup -- ../riverline-bot`，来源须匹配组件锁。已有安装更新后重新构建并重启服务。安装、开发模式和数据位置见[运行与使用](docs/running.md)。

## 文档入口

- [当前状态与能力](docs/current-status.md)
- [运行与具体使用](docs/running.md)
- [架构与组件边界](docs/architecture.md)
- [当前开发计划](docs/development-plan.md)
- [数据来源与评价边界](docs/data-sources.md)
- [旧Poker Agent采用分析](docs/poker-agent-adoption.md)
- [验证证据](docs/validation.md) · [Git协作](docs/git-workflow.md)
- [全部文档](docs/README.md) · [历史开发记录](docs/archive/README.md)

历史设计、交付和失败记录已归档；其“仅规划”“Mock阶段”等描述保留当时语境。当前状态以上述入口为准。
