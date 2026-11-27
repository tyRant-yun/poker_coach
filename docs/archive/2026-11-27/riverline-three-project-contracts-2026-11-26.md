> 历史记录：整理前的设计/交付状态，不作为当前开发指令。当前能力见[最新状态](../../current-status.md)；原始版本可从Git提交 `f416438` 追溯。

# 三项目边界与接口草案 v0.1

日期：2026-11-26。状态：**设计，未生成或接入以下新合同**。配套[总路线](riverline-three-project-roadmap-2026-11-26.md)与[下一轮任务](riverline-next-round-task-design-2026-11-26.md)。下文类型名是拟定领域名，不能拿它们替代现有已发布schema或宣称新MCP工具可用。

## 1. 依赖方向

产品壳调用Practice/Research应用命令；Practice调用RulePort和BotPort。Research调用SolverPort，可调用Bot的离线PolicyProbe，但不能在实时Bot请求中同步求大树。Bot不得导入Practice的SQLite、Research的DiskStore或前端组件。

共享合同只包含卡牌/金额/规则、不可变引用、公开事件/观察、错误、能力与版本。前端/MCP使用同一服务命令。每个业务对象有唯一写入者，跨模块交接引用固定版本；不允许“UI直接读取另一个项目的fixture”作为接入。

| 数据 | 写入者 | 其他项目如何使用 |
|---|---|---|
| Session/HandRecord/公共事件/行动前快照 | Practice | Research读取经权限检查的固定快照；Bot只收该玩家观察 |
| Study/Range/Tree/Spec/Job/Solution/Finding | Research | Practice保存固定研究引用；可消费合格训练定义与评价结果 |
| BotManifest/策略制品 | Bot发行流程 | Practice固定到会话/手牌，按声明能力加载；Research只读审计 |
| Bot局内/跨手记忆 | 对应Bot运行实例 | 按session+player隔离；备份/恢复携带版本和状态，不放进其他玩家请求 |
| TrainingProposal | Research，固定研究依据和目标条件模板 | Practice接受并补齐初始条件；Proposal不直接创建作答 |
| TrainingDefinition / TrainingPlan | Practice，固定接受的Proposal及实际训练配置 | Research读取固定来源，不能反向修改既有计划/作答 |
| Attempt/Exposure/Question/提示事件 | Practice的统一学习服务 | Research进入前登记相关答案暴露，旧课程迁移不产生第二事实账本 |

## 2. 牌桌身份与金额

`SessionConfig`拟包含：`sessionId/rulesRef/tableSize/heroPlayerId/players/positionMode/stackMode/botAssignments`。

- `playerId`跨同一会话手牌稳定；`physicalSeat`是牌桌座位；`dealerSeat`决定按钮；`position`是本手相对按钮的位置；`displaySlot`只用于UI。
- `ruleSeat`是当前规则helper的索引。现有PokerKit适配固定盲注顺序，Practice持有`physicalSeat ↔ ruleSeat`双向映射，所有私牌、行动、账本、派奖和事件都经过同一映射。映射版本进入手牌/重放。
- HU中BTN同时为SB，翻前先行，翻后BB先行；6-max位置依次按按钮确定。不能把HU SB拆成一个不存在的第三座位，也不能以活跃人数替代背景桌型。
- `positionMode=rotate/fixed/random`分别定义自然轮转、指定位置抽样与随机抽样。固定/随机模式需记录实际配置及抽样方式；旧按全局手数变Hero的历史不重写。
- 金额以规则声明的整数chips为事实，显式给出SB/BB/ante/chipUnit。动作的raise-to总额、当前街投入和本次增投是三个字段。研究centibb换算需保存原单位与盲注，仅允许精确换算；不按Bot默认BB=10解释Practice的BB=100。
- 旧手牌采用legacy映射/100BB重置规则读回；没有跨手玩家身份的旧记录不得伪造连续对手记忆。

## 3. BotPort

### 3.1 能力与生命周期

`BotManifest`至少含`botId/version/contentHash/contractVersion/runtimeRequirements`及：

- 支持的`originTableSize/activePlayers/street/depth/rake/ante/stackMode`，允许的历史/规则模型，适配器版本。
- 策略性质：`heuristic/fixed-policy/equilibrium-artifact/experimental`；支持/不支持的节点。`HU supported`不代表`6-max after folds supported`。
- 记忆作用域、可复现能力、真实动作分布是否可提供、CPU/内存/时间预算、会话重置/恢复/关闭方法。
- 工程/局部行为/行动价值/整体强度的证据引用分别记录；不以一个“verified=true”合并。

生命周期为load→startSession→startHand→observePublicEvent→decide→handResult→endSession→close。单个物理进程可服务多个隔离实例，但实例键必须包含session+player；不得因共享代码或缓存共享隐藏牌。缓存键含规则、当前玩家可见信息、策略版本/配置和作用域。

### 3.2 决策请求

`BotDecisionRequest`拟包含：

| 组 | 字段与含义 |
|---|---|
| 身份 | requestId、sessionId、handId、decisionSeq、handRevision、observationHash、actorPlayerId |
| 规则 | rulesRef、背景桌型、按钮/座位映射、SB/BB/ante、当前筹码单位、有效筹码、当前街/累计投入 |
| 观察 | 己方两张牌、当前公牌、公开行动前缀、各玩家公开状态/筹码；仅合法公开的摊牌信息可用于随后记忆 |
| 合法性 | 权威legalActions与精确raise-to下限/上限；toCall与可争底池语义明确 |
| 策略 | manifest/config固定引用、seed或声明非种子化、记忆token/版本 |
| 资源 | 相对budgetMs、取消token、进程/实例标识；绝对monotonic deadline不跨进程直接比较 |

请求中**禁止**完整deck、其他玩家私牌、未来公牌、宿主完整RuleView、Solver答案和未公开Bot诊断。范围估计只是输入假设；Bot不能请求“把其他Bot底牌用于准确决策”。

### 3.3 返回、失败与提交

`BotDecisionReply`拟返回同一请求身份/观察哈希、实际策略版本、`candidate/unsupported/timeout/cancelled/failed`、动作与可选分布/诊断、耗时/使用的模型与回退原因。分布未提供或只采样过一次时保持未知，不能补成单点策略当作完整概率。

Practice在应用行动前再检查handRevision、actor、观察哈希、token与legalActions。Bot不能直接提交动作或写牌局。非法/迟到/重复结果不执行；不把越界raise悄悄夹成另一个尺寸并称原策略。Practice选择可解释的合法保底策略，记录实际执行版本/原因；`check`合法时不能默认发送`fold`。

父层持有剩余时间和合法保底，工作线程/进程迟到结果隔离。进程超限/无响应有停止与重启路径。人工播放延时属于UI，不能放进Bot计算预算或数据库事务。策略计算耗时、父层决策等待、规则提交和客户端停留分别记录。

原始决策记录按实际行动/版本/seed/记忆引用保存。重放用户手牌执行已存动作，不重新运行Bot来猜历史。相同seed下因时间不足发生不同回退要如实记录，不宣称跨硬件严格确定性。

### 3.4 发行接入

`E:\hu bot`候选保持冻结，新增适配在新候选/接入包中实施。练习配置固定发行包摘要，而非绝对路径导入当前`.work`。候选的Python/SDK/native依赖与规则helper环境分离，首次校验可用性；不依赖连接平台WebSocket或用户平台凭据。平台入口保留，练习通过独立适配进入同一核心。

## 4. Practice→Research

`StudySource`固定hand/decision/rules/映射/公开前缀哈希，包含原背景人数、活跃玩家、座位/位置、原额账本和用户问题。导入只带当时板面，不带未来river。当前读权限仍由Practice执行；手后查看原手与研究引用可关联，不把研究变更写回事实。

原手事实、用户补充、Bot估计、版本化策略派生和外部导入分别注明。六人进入HU研究时保留弃牌/死钱与是否忽略bunching，求解人数、背景人数分开。没有合格范围或模型时保存问题，不能从Bot私牌/默认表自动拼出“真实范围”。

本次沿用现有引用语义逐步演进，不把各项目任意字符串ID直接当可跨库解析的固定引用。跨项目引用至少有项目/对象类型、id、版本和contentHash，保留sourceRef。

## 5. Research→评价与训练

`EvaluationEvidence`固定模型、Spec/Solution、节点/玩家/具体组合、行动树、单位/收益原点、质量状态、适用条件与来源。不匹配的规则、范围、树外金额、未知动作分布分别返回`unscorable`和原因。

`Finding`区分事实、模型内观察、解释、适用限制、未解决问题及反例。只有有证据的观察可用于策略反馈；解释文本不自动成为答案。

Research输出`TrainingProposal`（来源Finding/Study/Solution、目标问题及条件模板），Practice验证并补齐后创建`TrainingDefinition`与计划；定义固定从翻前开始的初始条件、对手策略/风格版本、抽样规则、评价覆盖和暴露政策。局部解不能唯一决定翻前范围和完整手路径；缺失初始条件须显式补齐。玩家偏离后合法继续，记录目标未到达；不强制行动。

已见原手重打、脚本路线、定向抽样与独立迁移分开标记。实际私牌/牌序只在Practice内部生成和保存，交给Bot的每次请求仍按观察隔离。换ID/花色不能自动抹去已见关系。

## 6. Research查询与版本

新容量profile须同时版本化原生reader、组合分页/聚合、模型和资源声明；旧数字河牌路径和`native-turn/3`类型化路径继续原义读回。保存浏览位置绑定固定解/路径/玩家，输入修改后旧解仍标原来源。

输入草稿可完整保存，预检明确拒绝不可计算的范围/树，不截断。按需读取局部节点、矩阵摘要和组合页，不把完整树/大范围数组塞入工作区快照、MCP或URL。质量未达目标、预算结束、取消、失败和中断分别记录。

## 7. 第一组跨项目黄金样例

至少冻结以下输入/输出和独立期望：HU BTN/SB首入、HU BB翻后先行、六人UTG首入、BTN/盲注防守、短全下不重开、未跟注返还/边池、六人剩两人但原生HU模型拒绝、金额单位不一致、隐藏牌/未来字段拒绝、旧版本Bot迟到、求解负载下合法动作、同一手导出/恢复和转牌前缀交接。

金额/规则用独立账本和规则测试，Solver沿用独立数值门，Bot策略使用其冻结候选的行为/价值门；桥接两边输出一致不能代替独立正确性。合同验证、真实消费者旅程和策略质量分列验收。
