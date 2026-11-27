# Solver合同入口

产品与[独立Solver](https://github.com/tyRant-yun/riverline-solver)按[组件锁](../../components.lock.json)接入。UI、工作区、业务作业和权限仍由唯一Node服务维护。

| 内容 | 来源与职责 |
| --- | --- |
| `engine.ts`、command/event/river schema | 控制帧与固定受限河牌输入；TS/Rust共享黄金输入 |
| `river-tree.ts`、schema2 | 一般HU河牌显式树与原生分页 |
| `turn.ts`、schema3/4 | 受限转牌、128组合分页profile、action/deal路径 |
| `turn.ts`、schema5/flop schema | 受限16组合翻牌三街与两次机会节点 |
| `business.schema.json` | 产品业务合同，由 `real-domain.ts` 生成，归产品所有 |

`npm run solver:contract`从TS更新schema；旧schema与原生解不改义。每个attempt使用新目录并核验输入/二进制/制品哈希。worker交换有界hello/solve/started/progress/终态帧，stdout只传JSON；父层核对后由产品事务发布固定解。取消、中断、预算结束和质量达标分别记录，不承诺原生解续算CFR。

`real_turn_solution_query`读取schema3–5的类型化路径；schema5显式使用 `hu-flop/5` 及三街bets。产品为存档兼容沿用案例 `.turn` 容器，旧数字河牌路径保持原义。只读取节点、组合页与聚合，整树不进入快照/Agent上下文。

当前边界见[状态](../../docs/current-status.md)，数值门见[基准](../../benchmarks/solver/README.md)。原单下注/六节点假设和历次工具数量见[历史合同](../../docs/archive/2026-11-27/entrypoints/solver-contracts.before-consolidation.md)。
