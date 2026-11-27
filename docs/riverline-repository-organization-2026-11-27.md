# 三仓库整理与旧Poker Agent采用分析

日期：2026-11-27。用户要求整理GitHub为总产品、Bot、Solver三个项目，并评估 `E:\poker agent` 的延续开发和融合。本轮实际建立两个独立开发仓库、补齐产品的固定组件校验/独立Bot安装，保留原始代码与历史，不改写冻结来源。最终远程状态、固定版本和验证在文末记录。

## 一、三个项目的职责

| 项目 | 本地与GitHub | 负责 | 不拥有 |
| --- | --- | --- | --- |
| 总产品 | `E:\poker_coach` / [poker_coach](https://github.com/tyRant-yun/poker_coach) | UI、练习/复盘/研究、规则/手牌/会话权威、数据保存、业务作业调度、教学与权限、Agent解释 | Bot策略核心、原生求解算法的独立开发权威 |
| Bot | `E:\riverline-bot` / [riverline-bot](https://github.com/tyRant-yun/riverline-bot) | HU策略/运行时、离线评估、平台适配、产品Bot JSONL适配器、版本发行 | 执行用户牌局、读取未知私牌/未来牌、计算实时LLM或外部Solver |
| Solver | `E:\riverline-solver` / [riverline-solver](https://github.com/tyRant-yun/riverline-solver) | 固定成熟引擎薄适配、版本化引擎协议、预检/计算/取消/原生分页、独立数值和资源门 | 产品数据库/作业权威、学习暴露、UI或Bot策略优劣结论 |

三个当前开发仓库保持私有。原公开 [riverline-poker-coach](https://github.com/tyRant-yun/riverline-poker-coach) 保留为旧产品/参考来源，本轮不删除、归档、改可见性或覆盖其分支。没有新建第四个Agent运行产品；解释能力属于总产品，竞赛执行器属于Bot。

产品保留完整Git历史。两个新仓库以显式来源提交/归档SHA-256和逐文件清单建立独立开发基线，没有篡改历史来伪装它们一直是独立仓库。`E:\hu bot` 仍是只读历史和冻结发行来源。

## 二、现在如何协作和启动

当前采用**独立源仓库＋总产品固定兼容快照**。Solver引擎/协议/数值基准与Bot适配器进入 `components.lock.json`，固定来源仓库、提交和逐文件摘要；`npm run components:check` 检测产品快照漂移，传 `--bot=../riverline-bot --solver=../riverline-solver` 可同时核对本机源提交及内容。新仓库是后续相关源码的修改入口，产品目录中的锁定文件是发行快照。

这一步不是分布式微服务迁移，也没有增加第二个业务状态服务。产品原有启动/同端口页面和Node业务权威保留；产品自己的 `business.schema.json`、UI、作业、进程监管与权限层继续在产品仓库。原生Solver仍按既有本机进程契约使用快照构建。需要升级组件时，在源仓库验证后选择固定提交，将允许文件映射到产品，再更新锁和集成测试；不自动跟随组件main、不静默覆盖本地变更。本轮只提供校验，不提供自动网络拉取/覆盖脚本。

```powershell
# 三个仓库相邻克隆；已有安装不必重新安装依赖
git clone git@github.com:tyRant-yun/poker_coach.git
git clone git@github.com:tyRant-yun/riverline-bot.git
git clone git@github.com:tyRant-yun/riverline-solver.git
cd poker_coach
npm ci
npm run components:check
npm run rules:setup
npm run bot:setup -- ../riverline-bot
npm run solver:build
npm run build
npm start
```

Bot安装仍兼容旧 `E:\hu bot` 冻结ZIP路径，但优先检测相邻新仓库。两条路径都逐项验证相同五文件核心哈希，全部验证后才写入；损坏包不会留下部分安装。真正策略升级需要新版本/允许指纹，不能借拆仓悄悄替换v2.2.2。Solver新仓库README有独立构建/数值门，Bot README有独立pytest/离线包入口。

暂未把所有TS进程适配器发布成npm包，也未把所有源码从产品物理删除。这个阶段仍有明确标记的固定快照；避免双处开发由锁定文件、来源提交和后续集成门约束。不是“三个仓库各维护一份同名产品”。

## 三、`E:\poker agent` 实际是什么

实际Git根为 `E:\poker agent\riverline-poker-coach`；本轮只读检查时分支 `feat/chipzen-foundation`，提交 `374b0e1f346cb746f252d44fa7b1ca57efe6390d`，工作区干净。顶层架构brief是设计资料，不自动作为实施指令。旧项目包含完整FastAPI/Python后端与Next.js前端，自己的规则/事件/持久化/教学服务；不是一个已完成、可以直接接入的独立AI Agent。

对其116个受跟踪业务Python文件做了AST语法解析，零语法错误；选定模块的类/依赖及SHA-256见[静态审计JSON](architecture/poker-agent-source-audit-2026-11-27.json)。旧项目要求Python `>=3.13,<3.14`，本机仅列出3.14.3；本轮**未运行旧项目后端测试或启动其服务**，不能继承其历史测试数字作为当前可运行证据。没有安装其全套依赖、读取`.env`、发送LLM请求或改动原仓库。旧项目声明AGPL-3.0-or-later，今后采用具体模块时保留其来源及第三方许可记录；本轮没有改变旧项目许可。

旧文档与实际代码已有差距：`PROJECT_STATE.md` 仍说手后worker尚无实现，但当前已存在 `solver/posthand_worker.py`、队列表和对应测试。该worker消费身份队列、从权威事件重建允许前缀，并调用既有受限L2 producer；不是我们现在Rust一般河牌/转牌/翻牌引擎的等价替代。Chipzen `competition/` 在受跟踪代码中不存在，现有只有开发约定和设计，不能称已经具备连接/参赛能力。

## 四、哪些值得延续，怎样融入

| 旧模块/资产 | 结论与目标项目 | 接入前必须完成 |
| --- | --- | --- |
| `coach/external.py`、`posthand_gateway.py`及测试 | 高优先级；借鉴为总产品可选的证据解释器，复用失败降级、只读工具与角色分隔设计 | 适配当前Report/Solution固定引用，外发信息裁剪；按真实数值逐项绑定，不能只验证引用ID存在；显式模型/预算/超时/密钥配置 |
| `ranges/update.py`、`belief.py`、`event_beliefs.py`与trace | 高优先级；作为产品条件范围链与Bot离线研究的算法/测试资产 | 对接当前整数金额与事件前缀，明确独立乘积/联合兼容假设；多人归一化不等于精确联合后验；缺策略、离树、零到达继续显式降级 |
| append-only事件、PHH、outbox/恢复测试 | 高优先级设计参考；总产品外部对局导入、可重建投影与恢复 | 旧HandEventV1不能直接作为当前HandView；先建版本转换与金额/座位/信息边界黄金牌谱，不迁移第二套数据库权威 |
| `simulator/bot_runtime.py`、Observation/LegalAction | 中优先级；供Bot runtime/平台适配补充测试与安全模式 | 当前BotPort已有进程时限/迟到防线，优先补测试/语义；不能整体导入旧simulator/FastAPI依赖到热路径 |
| 手后队列/worker、evidence生命周期 | 中优先级；产品持久化恢复/质量状态参考 | 沿当前唯一队列/制品仓扩展，不部署第二个Python求解调度权威；细查旧worker崩溃后solving认领恢复 |
| `theory/policy_artifact_data.py` | 仅教学/基线对照，按来源保留 | 源码明确是自写牌类桶、B级教学蓝图，限6-max100BB RFI/单次RFI，不覆盖limp/3bet后；**不能解决当前可信HU100BB行动EV数据缺口** |
| 旧L2、GTO artifact cache、fingerprint | Solver独立对照候选与严格匹配设计参考 | 与新仓库数值oracle逐项复核；不能将旧有限jam/缓存命中等同一般树或全街评分 |
| `docs/competition` 与顶层Chipzen brief | 转为Bot后续任务设计输入 | 平台/SDK/赛制必须另行核验；当前无competition代码、无本轮实战/上传证据 |
| 旧Next.js前端、FastAPI composition、Redis/PG整套 | 保留旧仓库维护与参考，不整体并入当前产品 | 整体合并会形成两套规则/状态/导航，增加迁移面而没有自动补齐可信求解能力 |

外部模型解释器的具体待加固点：当前 `TeachingText` 的定量标志由响应字段 `containsNumbers` 携带，检查有无引用；`validate_evidence_references` 核对引用存在，但没有逐数值验证其与引用EV/频率一致。`recommendedActions` 的EV/频率也以有引用为条件，不能据此断言模型数字可靠。迁移时由可信渲染层填入数字或用字段级引用验证值，LLM只生成可验证的文字结构。该发现来自源码静态阅读，未伪装成已运行的攻击测试。

## 五、建议的后续任务包

1. **G01 证据解释桥接**：当前报告生成只读EvidenceEnvelope，保留作用域、原点、质量、来源；先本地可复现契约测试，再做可选模型解释。没有Key仍可完整出报告。
2. **G02 条件范围与真实数据**：引入旧项目的离树/零到达/trace反例，继续寻找合格100BB原始数据；旧B级蓝图和Bot启发式不能用来关闭数据门。
3. **G03 外部日志导入**：以固定比赛日志/PHH小样本转当前手牌事件，回放核对账本、座位与当时权限；导入不反向更改原比赛事实。
4. **G04 Bot平台入口**：在独立Bot仓库核对SDK/公开契约与deadline，再逐步连通/日志/策略；平台账号、凭据、参赛和上传另行按任务处理。
5. **G05 组件升级发布**：新Bot或Solver提交通过各自门，再更新产品锁和集成旅程；需要真正移除产品快照时，另作可重现源码包/安装包迁移，不用两个可变路径替代固定版本。

这些是后续任务，不是本轮已实现的Agent、日志导入或比赛接入。总体判断：**旧项目有可延续的成熟模块和反例资产，值得融入三项目；不建议并行重建第二个完整Riverline产品，也不做整仓merge。**

## 六、本轮验收与远程交付

Bot新仓库381通过、2项明确跳过（可选v1.2.3对照/v1.0工件未分发），核心固定包校验通过；Solver新仓库14 Rust、12 schema及20个独立数值问题通过。详细记录分别见两个新仓库的 `docs/BASELINE-ACCEPTANCE-2026-11-27.md`。产品类型检查/构建、20项规则/报告/Bot测试，以及独立路径安装/旧归档兼容/损坏拒绝已实际通过。组件固定引用为Bot `276cfe900bcccae53cf6783b6bfcd456a9517a4f`、Solver `6569a01cbe57cf109c4bd240a415fa31d5931a7b`；63个产品快照文件已与本机两个固定源提交逐项核对通过。原始Bot运行核心含CRLF，Git属性保留发行字节以维持指纹；源码快照已按实际Git存储字节校验。两个新私有GitHub仓库已实际建立并推送main，提交分别为上述固定引用。总产品原远程main及默认demo/development均为本地当前历史祖先；本轮以无force的快进方式更新main并将其作为产品默认入口，旧开发分支和所有标签保留。最后逐仓核验实际远程SHA/可见性，不把本地存在当成上传成功。

没有部署、参赛、LLM调用、旧牌谱迁移或冻结来源修改。原公开旧仓库保持原分支与提交；本轮代码源文件复核/导入不意味着采纳旧项目所有策略真值或分发整个旧产品。
