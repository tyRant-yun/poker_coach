# 旧Poker Agent采用分析

来源为 `E:\poker agent\riverline-poker-coach`，已审计提交 `374b0e1f346cb746f252d44fa7b1ca57efe6390d`，分支 `feat/chipzen-foundation`。它是独立Python/FastAPI＋Next.js旧产品，具备可复用模块；当前三个项目保持各自权威。

## 当前采用结论

| 资产 | 目标与下一步 |
| --- | --- |
| 外部teacher、posthand gateway | 产品解释器G01；适配当前Report/Solution，可信层绑定数值/引用，限制外发数据并保留失败回退 |
| range update、belief、event trace | 产品条件范围链/离线Bot研究G02；保留离树/零到达、公开前缀与联合兼容假设 |
| 事件、PHH、outbox/恢复测试 | 产品日志导入G03；先建版本/金额/座位转换及回放门，沿现有唯一业务状态落地 |
| Bot runtime/Observation/LegalAction | Bot安全语义和反例补充；按需采用轻依赖部分 |
| 手后worker/证据生命周期 | 产品调度与恢复参考；已有Python受限L2 worker，不替代当前Rust一般树 |
| 旧L2、严格fingerprint cache | Solver独立对照候选，先过数值门；缓存命中不等于全街能力 |
| Chipzen设计文档 | Bot平台方向G04输入；受跟踪代码中尚无 `competition/` 实现 |

旧翻前包是自写牌类桶/B级教学蓝图，限6-max100BB RFI/单次RFI，排除limp/3bet后等路径，不能关闭可信HU100BB行动EV数据门。旧整套UI/API/数据库不直接并入当前产品。

## 解释器迁移前加固

旧模型检查 `containsNumbers`与引用存在，未逐个验证数值和其引用EV/频率一致。新解释器应由可信渲染层填入数字，或进行字段级引用/值校验；模型仅解释固定事实。此结论来自源码阅读，不冒充攻击测试或已接入LLM。

## 证据与状态

116个受跟踪业务Python文件AST解析零语法错误；[静态审计](architecture/poker-agent-source-audit-2026-11-27.json)保留模块摘要。旧项目要求Python `>=3.13,<3.14`，机器仅列出3.14.3，本轮没有启动旧产品或重跑其测试，未读取`.env`或调用模型。

原仓库、公开GitHub历史与冻结Bot来源保留，尚未整仓merge。旧项目声明AGPL-3.0-or-later，采用时保留来源和第三方记录。[完整拆仓研究](archive/2026-11-27/riverline-repository-organization-2026-11-27.md)是历史依据，当前任务由[开发计划](development-plan.md)维护。
