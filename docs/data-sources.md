# 数据来源与评价边界

更新：2026-11-27。当前仍没有已接纳的可靠HU100BB/no-rake全行动EV策略包。

## 已取得的数据

[George Li官方数据](https://georgelipoker.com/data)提供CC BY4.0的HU推弃策略与权益矩阵，署名George Li, georgelipoker.com。[原始文件与许可](../benchmarks/data/georgeli-2026-11-27/NOTICE.md)保留原始字节和哈希。仅覆盖1–20BB、无ante、SB推/弃与BB跟/弃；EV以发盲前为原点。

独立兼容组合/行动EV/BR重算与三组权益抽检通过了有限核验，[证据](solver/validation/af-preflop-candidate-evidence-2026-11-27.json)不等于整个权益矩阵的独立认证。它不能评价当前100BB raise/limp/call练习，未安装为评分来源。

已检查的100BB开源候选只有频率，缺少行动EV和足够设置/来源依据，未接纳或分发。供应方目录发现不等于取得策略数据。完整过程见[历史获取报告](archive/2026-11-27/riverline-preflop-data-acquisition-2026-11-27.md)。

## 产品接纳规则

`riverline-strategy/1`限定HU100BB、50/100盲注、无ante/抽水、chipEV和当前节点沉没成本EV原点；必须记录来源哈希、设置、质量声明、署名和用途依据。导入只成为候选，接纳需实际核验；结构校验或人工文字本身不证明求解正确。

路径、位置、组合与金额必须精确匹配。仅频率不能产生EV差；原点错误、缺组合、离树、零到达和合成来源不得冒充评分。旧Poker Agent的B级蓝图和Bot启发式也不能关闭这项数据门。

## 已有自动分析

自动转牌/河牌使用有限牌类假设，未根据整条历史更新，允许参考树内比较；不代表对当前Bot的真实最佳策略。节点EV不等于本手实际收益，独立局部EV差不能相加为整手损失。未知显示“未评价”。

策略库独立存于 `strategies.sqlite`，整手/研究导出尚未包含它；原始规范包与核验记录另存。后续采用/分发继续保留来源、许可和固定版本。
