# S1 Solver 与范围领域合同 v0.3

日期：2026-11-12。状态：设计，非现有 API；配合 [任务包](solver-s1-task-design.md)、[产品/内容](solver-s1-product-content.md)、[MCP/运行时](solver-s1-mcp-runtime.md) 使用。沿用 TypeScript strict、应用命令、Zod 与异步适配器；v0.3 新工作区使用唯一本地业务运行时，旧 IndexedDB 保留迁移来源。

v0.2 依据 [实际源码与复用方案](solver-reuse-research.md) 补充适配要求：优先复用完整引擎，保留公共产品语义；S1 仍不接真实计算。

v0.3 按 [新增约束映射](solver-s1-constraint-mapping.md) 冻结共享合同 `riverline-analysis/1`。这里“冻结”指开发入口的单一语义/schema 基准，尚未编写或通过运行测试；后续不兼容变更必须显式升版及迁移，不能让 UI/MCP 分别解释同一字段。

## 1. 所有权与值对象

BC01 拥有玩家、局面、投入账本、预置行动树；BC02 拥有范围/策略草稿与版本及来源；BC03 拥有规格、作业、结果与指标定义；BC04 拥有研究、假设与比较。教学身份和答案暴露继续归 BC06/07，Agent 只编排同一命令。

| 对象 | 必须字段/含义 |
|---|---|
| VersionRef | id、version、contentHash；hash 算法版本明确，身份不能只靠显示名 |
| GameDefinition | NLHE、cash、HU/6-max、座位/按钮、盲注/前注、抽水规则及 cap/适用条件 |
| PlayerState | 稳定 playerId、seat、position、initialStack、remaining、streetContribution、totalContribution、active/folded/all-in |
| SituationVersion | gameRef、players、street、分街 board、行动历史、当前玩家、账本、已知牌/未知字段及来源 |
| ActionTreeVersion | root、父子节点、decision/chance/terminal/segment-end、结构化动作、覆盖清单 |
| RangeVersion | playerId、scope/nodeRef、非负组合权重、输入/假设/派生来源、计算模型 |
| PolicyVersion | situationRef、treeRef、nodeRef、playerId、范围 ref、逐组合动作概率、辅助身份 |
| LockConstraint | playerId、nodeRef、combo 集合、固定行动概率、其余策略处理、基准策略 ref |
| AnalysisSpec | 操作类型、上述固定引用与有效载荷摘要、约束、价值模型、算法配置/质量目标、语义指纹 |
| AnalysisJob | specRef、attempt、阶段、事件、cancel token、结果 ref；重试不改原规格 |
| SolutionArtifact | specRef/fingerprint、来源、引擎/fixture 版本、节点覆盖、结果查询索引、单位/指标定义、质量 |
| RangeSetVersion | 局面条件及节点→玩家→范围/策略引用的集合；非无条件位置表 |
| PostflopHandoff | 上游固定引用、双方范围、牌面、账本、IP/OOP、弃牌历史、推断模型、可用性 |
| ComparisonArtifact | 基准/变体固定 ref、控制变量、派生变化、可比性、观察、用户解释与局限 |

补充必需字段：AnalysisSpec/SolutionArtifact 保存 tableFormat（HU/6-max）、backgroundPlayerCount、activePlayerIds、analysisPlayerIds；analysisScope 为 whole-game/subgame/local-node，continuationValueModel 声明 exact-subtree/abstracted/heuristic/synthetic 及版本/边界。整体解与局部结果独立，翻前接 HU 翻后只得到有来源的局部分析，不升级为 whole-game 六人均衡。

结果绑定范围/树/锁定约束 refs 以及 engineId/commit、algorithmId/version/config、adapterVersion；S1 填真实存在的 mock 实现/算法身份并显式 synthetic，不虚构真实引擎。旧记录缺字段保留未知，只在新制品完整声明。引擎内部类型只存在适配层，不作为局面、范围、教学的公共对象。

金额用最小单位整数；演示 `100 units = 1bb`，不使用二进制小数保存筹码。动作保存类型及语义：fold/check/call/bet/raise，金额区分增量与 raise-to；pot-percent 的分母规则写入树版本。展示标签/颜色不作为动作语义。

HU 的 seat 与 position 分开，SB/BTN 为同一玩家，翻前先行动、翻后 BB 先行动；6-max 使用 UTG/HJ/CO/BTN/SB/BB。IP/OOP 从仍活跃玩家及街道推导，不硬编码 BTN 永远是参与者。

## 2. 范围和策略数学口径

用户输入组合权重与逐动作概率均为 0–10000 整数；有效非零组合的完整策略概率必须合计 10000。输入权重是相对质量，不要求全范围合计 10000。范围外、死牌、不在声明资产覆盖内、未分配不是同一状态。

未来引擎返回的浮点权重/频率保留原始精度及编码映射，不先压成整数编辑值。恢复为可编辑草稿时的取整生成独立派生版本，不能影响原始解及其 EV。

派生范围引用 baseRangeRef、policyRef、完整行动路径与计算模型。修改它必须创建新的 user-hypothesis 范围版本，保留 derivedFrom 和编辑说明，不反写原范围、原策略或固定解。输入权重、行动概率、派生路径质量及真实条件到达概率分别建字段；真实条件概率未计算时返回 unavailable，不能用自己的保留比例代替。

单玩家自身路径传播的结构运算：`w_next(c) = w_current(c) × policy(c, action)`，概率先除以 10000；公共牌过滤显式处理。多步计算使用不丢有效精度的表示，显示时才取整。保存基础范围、完整路径和算法版本，可复算，不仅保存已取整矩阵。

本轮这一运算标为 `own-action-reach`，只表示自己的行动路径权重，不能称完整条件后验。对手行动造成的跨玩家卡牌相关、匹配组合权重、弃牌推断/bunching 均未计算。`joint-card-conditioned` 仅留作未来能力类型，S1 不返回该身份。

范围视图必须展示：基础权重、路径派生质量、合法组合数、显示归一化比例、范围来源与模型。总质量为零时返回 unreachable，不除以零、不凭空恢复父范围。范围内未分配策略使传播 incomplete，不默认为弃牌或 0。

动作频率聚合：`Σ w(c) × p(a|c) / Σ w(c)`，明确本节点使用的权重版本；牌类矩阵同样按有效具体组合加权。示例 `w1=1,w2=3`，下注概率分别 100%、0%，聚合为 25%，不是 50%。

这不是节点全局到达概率。后者需要机会事件与所有相关玩家的模型；S1 只显示声明的路径质量/自身保留比例，不把它命名为全局到达率。固定 Hero 的对手权益/EV 应以兼容组合为条件；本轮没有引擎时仅返回精确配对合成值，不用简单范围平均伪造。

## 3. 固定输入与指纹

分析分成 load-reference、solve-equilibrium、evaluate-policy、resolve-with-lock。前三个词描述操作语义，执行来源由 synthetic/未来 engine 区分。求均衡不依赖用户草稿；评价必须固定 policyRef；锁定重新分析必须固定约束与基准。

指纹覆盖：游戏/座位/位置、全部筹码与账本、抽水、分街公共牌、已声明已知牌及推断模型、完整行动历史、双方/多方范围、树动作语义与覆盖、操作类型、相关策略、锁定、价值模型与求解语义配置。规范化算法有版本。

- 对象键、组合序可规范化；翻牌三张允许按约定排序，turn/river 保留街道归属；不能排序五张牌抹去发牌顺序。
- 同名 B33 但实际尺寸/分母不同必须不同指纹；相同牌面但 HU/6-max 不同。
- load-reference/solve 不因无关用户草稿变化失配；evaluate-policy 必须随策略变化而变化。
- 演示速度、时间戳、任务 ID、skip、故障脚本不进入扑克语义指纹；执行请求另保存 adapter/fixture 版本与设置用于重播。
- 制品还绑定引擎/算法/数据版本，不把相同输入的不同来源结果无条件视为可互换。

取消检查发生在请求前、异步阶段和最终登记前。登记使用 job token 与预期状态，拒绝取消后迟到结果；最终校验失败记 failed，不因跳过等待进入 completed。

## 4. 状态、能力与查询

能力描述至少列出 game/人数/街道、操作、抽水、支持的树/尺寸、范围模型、Node Lock、指标、导入格式与版本、是否可恢复继续计算。S1 不声称支持任意规则；合法字段、树中支持动作和有数据覆盖三者分开。

- 预检：valid / invalid / unsupported / uncovered。invalid 指字段/约束无效；unsupported 指能力不支持；uncovered 指支持本类流程但无匹配资产。
- 作业：queued / preflight / running / postprocessing / cancel_requested / completed / cancelled / failed / interrupted。取消确认与刷新/运行时中断的区别见运行时合同。
- 查询可用性：available / uncovered / unsupported / incomplete / unreachable / stale；附原因与原输入引用。
- 质量：not-evaluated / demo-target-met / demo-incomplete；S1 均非数值收敛证明。
- completed 只说明执行结束，可能得到 uncovered 或 incomplete 制品；失败/取消不创建伪可用策略。

目标接口（实现名称可调整，但职责不可合并）：

| 应用操作/查询 | 输入 | 返回 |
|---|---|---|
| getCapabilities | adapter/version | 支持矩阵与限制 |
| preflightAnalysis | AnalysisSpec | 字段问题、能力与资产覆盖 |
| loadSolution | 固定规格/solutionRef、允许信息上下文 | 制品或明确缺失 |
| runAnalysis | specRef、幂等键 | jobRef |
| cancelAnalysis / retryAnalysis | jobRef | 状态/新 attempt；旧输入不变 |
| queryNodeStrategy | solutionRef、nodeRef、playerId、视角 | 策略、范围引用、覆盖与身份 |
| queryComboMetrics | solutionRef、nodeRef、combo、metricIds、视角 | 按项可用性和指标 |
| queryAggregate | 固定结果、节点、筛选及分母 | 权重/频率/构成，不混合口径 |
| deriveActionRange | rangeRef、policyRef、action | 派生范围或 incomplete/unreachable |
| createHandoff | 固定路径、范围 refs、牌面 | 新规格/不支持原因 |
| compareAnalyses | 基准/变体 refs、受控变量 | 比较资格与各指标差异 |

所有返回均是投影；fixture 只能由适配器/内容发布器访问。新能力先建 `modules/solver`、`modules/ranges` 的领域与应用边界，旧 `ports`/`workspace` 使用兼容桥；不把已有学习、复盘对象一口气迁到新结构。

所有核心业务动作必须通过 MCP 暴露，工具清单、真实客户端和 UI/MCP 共用状态要求见运行时合同。纯应用函数测试不能替代实际 MCP 调用；不允许两个入口分别维护 store。浏览器 reducer 可用于暂存/展示，但业务命令由共享服务执行和持久提交。

真实适配额外要求：显式建立产品 comboId 与 engine private_cards 的双向映射、动作顺序、卡牌编码与语义路径。固定树引用不使用会变动的裸 actionIndex。节点查询若使用可变引擎游标，须以会话隔离或串行定位保证两个面板不串节点；切换后先更新引擎要求的范围缓存。`normalized_weights` 的名称不表示其总和为 1，接口分别返回原始范围质量、卡牌兼容质量及用于显示的归一化比例。

Node Lock 在新建可求解实例上应用，按库生命周期先分配、设置约束、再迭代/最终化，不修改已经固定的旧解。采用 step 入口调度时保存真实迭代编号，取消延迟按实际单步耗时报告。引擎原生存档作为带校验和及引擎 commit 的独立 blob；是否可读、可浏览、可续算为分别验证的能力。

## 5. 指标与比较资格

MetricDefinition 至少包含 id/version、含义、playerId、单位、金额换算、价值基准（当前节点/全手，是否包含已投入）、抽水处理、评价分布 ref、条件化范围、有效动作、范围模型及覆盖。权益与 EV 不互推。金额明确 raise-to/新增投入、尺度分母与舍入规则；EV 收益原点不能仅以“bb”单位代替。

动作 EV 不足以评价任意整树策略；本轮频率距离可真实计算，只有精确配对策略资产才有合成策略收益。无值显示“未提供/不适用”，不得用 0 代替。

同一方法下结构距离使用加权 TV：`Σ w(c) × [Σ_a |p_user(a|c)-p_ref(a|c)| / 2] / Σ w(c)`，概率使用 0–1。要求同节点、同动作语义、完整目标范围与固定共同权重；不完整返回不可比较，不将缺失项当 0。

定量 EV 比较要求相同价值定义、单位、玩家视角、游戏/筹码/抽水与控制条件。锁定实验允许约束不同，但必须固定其余条件、声明比较类型和质量资格。根范围改变时最多分别报告各自条件值；跨范围汇总需预先定义共同评价分布，S1 不实现该数值比较。质量不足不自动给策略优劣排序。

编辑保护仅影响编辑命令；Node Lock 是 AnalysisSpec 的约束。变体自定义后不匹配预置时保留假设，不能返回预置收益。观察、用户解释、理论引用和合成示例结论分别保存。

## 6. 存储与兼容

v0.3 **替代**此前新建 browser `riverline-analysis-s1` 与跨新旧库双写设计。新权威 workspace 由本地服务保存，schemaVersion=1、contractVersion=`riverline-analysis/1`，与现有浏览器 schemaVersion=1/2 分开。细节见运行时合同；UI/MCP 通过同一 repository/服务读写。

- 原 `riverline-demo`、`riverline-demo-t1` 不被破坏性升级；通过浏览器导入桥只读读取旧快照，统一服务创建带来源的新副本，以旧库/对象/version/哈希防止重复迁移。当前课程、首次作答、暴露与引用一并保留，活动状态不在两端双写。
- 无法确定 HU/6-max、抽水、历史等的旧案例保留 unknown，不默认升级为完整规格。旧报告只读保留其原口径，不能伪造新引擎/质量字段。
- S1 不反向覆盖旧对象。新研究可继续引用旧 caseId，但新数值结果属于新制品；缺旧源可只读展示保存的快照。
- 备份新增独立 analysis envelope，显式标识格式版本；旧版导入器不用于打开新格式，新导入器需兼容现有备份。
- 新权威存储内业务变更/引用/幂等原子提交；旧库导入封存原件并保存 operationId，浏览器与本地服务不做跨库分布式双写。
- tools、resources、研究页与导出调用同一信息投影，含答案读取先在共享暴露账本登记，再返回内容；中断或历史不全保守记 possible-exposure/unknown。无法完成登记时拒绝揭示。
- 导入预检完成后再写；失败新对象保持隔离且不设为活动工作区，重试按 operationId 幂等恢复；不撤销已发生的暴露事实。
- 缺 fixture/hash 错误只读封存，导入者自报 engine/verified 不提升可信度。真实引擎结果入口在 S1 不启用。

页面刷新/关闭不使本地作业 interrupted；仅运行器/worker 实际中断才标中断。显式重试复用旧 spec；S1 不承诺 checkpoint 续算。重置提供清楚的本应用数据范围，损坏原件可下载；不删除其他应用存储。完整解独立存制品仓，工作区只保存 manifest/ref，不反复复制全树到快照。备份必须包含有效依赖，不只导出无法解析的 ID。

## 7. 必须验证的不变量

组合映射与死牌；位置/角色；权重与概率；加权聚合；零到达/未填写；固定规格及分街指纹；不同操作的策略绑定；账本；上游 stale；精确配对与未覆盖；锁定保护区别；取消请求/确认/迟到/重试；指标与比较；实际 MCP 双入口；批量原子/冲突/幂等；分页/字节预算；独立制品完整性；迁移与统一暴露；旧内容历史不被重写。具体 SJ01–SJ21 见配套产品文件。
