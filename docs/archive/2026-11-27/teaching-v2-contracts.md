> 历史记录：整理前的设计/交付状态，不作为当前开发指令。当前能力见[最新状态](../../current-status.md)；原始版本可从Git提交 `f416438` 追溯。

# T1 领域、命令与数据契约 v0.2

日期：2026-11-12。状态：设计，未实现接口。本文中的名称是后续实现合同，不是现有 API 声明。技术栈延用 [已确认方案](technology-selection.md)。

配套：[产品旅程](teaching-v2-product-design.md)、[内容与答案](teaching-v2-content-spec.md)、[任务验收](teaching-v2-task-design.md)。

v0.2 补入 [理论知识库契约](teaching-v2-knowledge-design.md)：Knowledge Context 独立拥有理论主张、来源、定位、审核、适用性与检索，Teaching Content 持有引用，不复制成无来源讲解。

## 1. 领域边界与文件落点

| 边界 | 决定权 | 拟落点/复用 |
|---|---|---|
| Teaching Content | 课程/题目/解释/对照/类别/版本与资格 | 新 `src/modules/teaching/content`，固定资产在 `src/fixtures/teaching` |
| Knowledge | 主题/概念、原子主张、来源/定位、审核、覆盖/冲突、检索和引用资格 | 扩展原 Knowledge 模块，独立知识命令工厂与本地索引 |
| Learning | run、阶段、作答、暴露、迁移和复测 | 新教学命令工厂；复用现有 PracticeSession/Attempt 的兼容视图 |
| Study/Strategy | 策略作品、固定输入、节点和编辑事务 | 复用现有 workspace、research 和 StrategyEditor |
| Evaluation | 固定规则、可评价资格与反馈制品 | 新教学评价纯函数；旧研究报告口径不变 |
| Agent | 教学意图编排、预算、工具轨迹和成果引用 | 复用 Mission，工具经同一 command/query 入口 |
| Persistence/Transfer | 原子快照、迁移、校验、重映射、原件恢复 | 扩展 repository/schema/transfer，不由页面直接写库 |

这些是前端模块，不是微服务。开发时只在首个消费者落地时建立文件，不预先创建空层。UI 不直接导入完整课程 fixture，Agent 也不绕过应用层读取答案。

内容资产不可变；用户 run 是独立聚合。原始研究作品与课程运行按引用联系：用户修改研究分支不覆盖课程固定例题，课程也不修改原研究历史。

新研究场景注册为 TP01（LP-A）和 TP02（LP-B），与旧 S01–S10 并存；扩展现有 ScenarioId/schema 和目录查询，不靠旧 S08 改名。旧 fixtureVersion 保留，新内容使用独立 packageRef/hash 命名空间。新参考匹配同时检查内容版本、输入和目标；示意作业的完成质量只代表演示生命周期，不宣称数学收敛。旧结果与新内容的字段差异由适配器处理，不给所有历史报告补造来源。

## 2. 关键对象和身份

| 对象 | 最小字段与不变量 |
|---|---|
| LearningObjective | id、version、可观察目标、先修与证据类型；不保存确定 mastery |
| LessonPackageVersion | id、version、contentKind、publication、review声明、assetHashes、dependencies、stepDefinitions、policyRefs；发布后不可原地改 |
| ExerciseDefinitionVersion | id、version、objectiveRefs、inputRef、targetScope、givenScope、responseKind、allowedInformation、answerRef、evaluationPolicyRef、exposureKey；给定与评分集合不得混淆 |
| LessonRun | id、packageRef、revision、status、currentStep、stepStates、prediction/attempt/experiment refs、createdAt；切包版本必须新建 run |
| Prediction | id、run/step refs、action/claim选项、reason、confidence或unknown、inputRef、commitSeq；提交后固定 |
| TeachingAttempt | id、definitionRef、run/sessionRef、response、originByTarget、assistedEvents、exposureAtStart/Submit、parentAttemptRef、taskKind、evaluationRef；首次不改写 |
| ExposureRecord | workspaceId、seq、assetRef、canonicalExposureKey、scope、kind、source、activeAttemptRef、at；追加、不撤销 |
| EvaluationArtifact | id、attemptRef、policyVersion、sourceRefs、eligibility、facets、limitations；unknown 与 0 不混同 |
| HypothesisExperiment | id、predictionRef、baselineRef、variantRef、controlledInput、derivedDiff、observations、conclusionRefs；结论修改形成新版本 |
| ReviewItem | id、objective/package/exercise refs、dueAt、reasonRefs、status、previewAttemptRefs；预览不完成真实到期项 |
| RangeProvenance | rootRangeRef、ownActionPath、exactWeights、boardFilter、simplifications、hash；不是未实现 joint matchups 的替代品 |

`assetRef` 为 `{packageId, packageVersion, assetId, assetVersion, hash}`。owned ID（run、作答、任务等）可以导入重映射；内容地址和暴露键不能因复制随机改名。

UI 中“独立”收敛为“本次无辅助”；新题状态另存，不能从 `assisted=false` 推出从未见过答案。旧 Attempt 作为 `legacy-unclassified` 保留，不补造过去的精确暴露记录。

## 3. 学习过程状态

LessonRun：`active / paused / completed / abandoned / blocked`。学习主体完成可进入 completed，但迁移/延迟任务独立保留状态；完成课程不表示三道迁移都答对、复测到期或技能掌握。

阶段草稿可编辑；提交动作产生不可变 Prediction/Attempt，并推进阶段引用。回看只读，明确“修订”时产生新记录。连续测验的各节点回答先固定，整个片段结束后评价与答案一起释放；未覆盖/提前弃牌用明确终止原因，不制造后续回答。

Revision 对 run/相关研究草稿分别检查。一个命令对多个对象的修改在内存中构造完整新快照后一次提交，不允许“提示返回了，辅助标记还没登记”的中间状态。

## 4. 命令目录

所有写命令含 `commandId`（幂等键）、目标 `expectedRevision`；重复相同命令返回原结果，不重复创建作品。返回 `{ok, artifactRefs, nextProjection}` 或结构化错误，不能只返回一句成功文本。

| 命令 | 输入要点 | 事务副作用 |
|---|---|---|
| startLesson | packageRef、entryMode | 新 run、固定依赖与初始投影；不自动复制参考为作答 |
| saveStepDraft | run、step、response patch | 仅当前草稿；未填集合可以保存 |
| commitPrediction | draftRef、skip标记 | 固定预测/显式跳过，推进证据阶段 |
| requestTeachingHint | attempt/step、level | 先登记暴露与辅助，再返回本级提示 |
| revealTeachingEvidence | assetRef、reason | 登记作用域、必要辅助和揭示，返回允许证据 |
| submitTeachingAttempt | definitionRef、response snapshot | 固定输入/规则/身份，锁定回答，再生成评价制品 |
| reviseTeachingAttempt | oldAttemptRef | 新辅助修订草稿，旧 Attempt 保持不变 |
| beginLineSegment / commitLineDecision | segmentRef、mode / node、action | 固定片段模式与逐节点回答，检查路径与账本 |
| createTeachingExperiment | committedPrediction、contrastRef | 固定基准/变体，复用研究命令建分支与模拟任务 |
| recordTeachingConclusion | evidenceRefs、conditions、text | 新结论记录；不能改实验输入 |
| assignTransfer | run、objective、selectionPolicyVersion | 固定选题和选择理由；无新题返回 POOL_EXHAUSTED |
| scheduleReview / submitReview | dueAt / itemRef | 幂等排期；到期作答才完成真实 ReviewItem |
| createTeachingResearchCopy | inputRef、sourceRun | 新 StudyCase，显式 origin；原 run 和版本不变 |
| inspectTeachingImport / importTeachingCopy | payload / inspectionToken | 预检无修改；确认复制含内容/暴露关系，一次落库 |

示例错误码：REVISION_CONFLICT、CONTENT_MISSING、CONTENT_DISABLED、NO_MATCHING_FIXTURE、SCORING_UNAVAILABLE、EVIDENCE_NOT_ALLOWED、POOL_EXHAUSTED、STORAGE_UNAVAILABLE。消息说明保留了哪些输入及可继续入口。

本目录是 T1 必需行为；可以复用现有命令实现，不要求每条都独立建服务。所有通过 UI 和 Agent 调用的结果应一致。

## 5. 查询与信息投影

| 查询 | 可返回 | 必须排除 |
|---|---|---|
| getLessonCatalogue | 目标、身份、阶段名、覆盖与版本状态 | 留出题答案、会暗示答案的题目缩略图 |
| getLessonProjection | 当前允许输入、自己的回答、阶段导航和可用命令 | 后续牌、未发生行动、参考/答案/解释正文及其统计侧信道 |
| getExerciseProjection | 当前题干、当前公开牌、目标/给定集合、允许动作 | 原始 SolveInput 中藏有的参考 choices、未来、对手私牌 |
| getTeachingEvidence | 已登记揭示且在作用域中的证据 | 其他迁移题、未揭示片段节点 |
| getLearningEvidence | 固定作答与多维反馈、暴露/辅助、样本范围 | 由操作次数推断的真实能力提升 |
| getContentInspection | 元数据、校验、来源及禁用原因 | 正在独立作答时无登记地浏览答案内容 |

仅有 GET 的返回不能自行产生未登记的答案暴露；请求答案必须先走 reveal 命令。研究页、知识正文、内容检查器、精确报告链接和 Agent 工具查询都使用同一暴露入口。路由查询参数不能提升权限。

这不是对浏览器开发者工具的防作弊系统；目标是产品 UI 与 Agent 不意外泄露，明确记录可观察的学习条件。

## 6. 暴露键、范围和辅助的精确定义

`canonicalExposureKey` 基于答案所涉及的规范化事实/输入、目标组合集合与语义问题键，排除随机对象 ID、标题、措辞和评分规则版本。两题仅换标题或改评分阈值仍等价；真正不同的牌面/组合/条件有新键，但共享题解中的同一事实也可以有共同子键。

语义问题键/别名由内容作者明确登记，不使用 LLM 猜等价；牌面、组合、范围和动作使用既有规范化/稳定排序，再以确定性哈希构键。相同学习目标或通用公式不等于同一题答案：学过权重公式后，对新输入数值计算仍可作为迁移；同一输入答案换措辞则不能。相同公开事实若已经作为答案正文揭示，相关题标 seen/partial；只显示新题必需的输入不是自动揭示答案。

| 对比 | 新题判定 |
|---|---|
| 同题仅改 ID、标题、措辞或评分版本 | 同一暴露身份 |
| 同一 LO，新组合/牌面或新数值，未见过该答案事实 | 可以是迁移候选 |
| LP-A/LP-B 引用同一固定翻后事实 | 共享对应事实暴露；不同示意策略版本不互称相同答案 |
| 通用“不看总频率推 EV”题仅换背景 | 显式别名关联，不能靠换牌面伪造新题 |
| 共享部分答案事实 | 标部分已见，保留练习，但不计完全新题 |
| 无法确认导入历史或语义映射 | unknown，不按未见处理 |

作用域支持 `input-fact / combo-set / node-policy / explanation-claim / line-future`。打开整个参考范围使该节点的所有组合答案暴露；只看一个组合不自动声明全范围已看，但它会影响包含该组合的题目。导入/导出含答案文件标为 `possible-exposure`，不能算“本工作区未见”。

状态至少为 `no-record / seen / partial / possible / unknown-history`，界面用“本工作区无对应暴露记录”表达 no-record。它不证明外部未见；内存模式/缺失导入历史为 unknown，不参与新题保持率汇总。

提示影响：针对当前题的任一级提示均使当前 Attempt 辅助；白名单中的通用术语帮助（如 bb 单位含义）不辅助。提交后反馈不会追溯污染已固定的首次作答，反馈后“修订”一律辅助。另行“重新测一次”可以记录本次无辅助，但仍为已见原题，不能自动计迁移。

事件顺序以 workspace 递增 seq 决定，时间仅用于展示。提交时固定 `exposureAtSubmit` 截止序号；异步评价期间再查看答案不改写其身份。评价返回前作答已经锁定，重复点击无新 Attempt。

持久工作区的 reveal 先等待暴露/辅助事务保存成功再释放正文；失败时不假装保存，可切到明确标注的辅助内存会话，身份为 unknown-history。内存会话与后续恢复的持久工作区不能合并声称连续“未见”。清空记录后只承诺新工作区内的可观察状态，不承诺忘记了答案。

## 7. 局部策略作品与评价

每题定义 `targetScope`、`givenScope` 和 `responseOrigin`。目标每组合所需动作概率合计 10000，0 有意义、未填写另计；非目标部分不能作为遗漏。批量操作、锁定、撤销重做使用既有编辑事务，不能改给定部分。

题目可以记录用户的自由策略，也可以明确要求复现作者示意分布。前者没有战略真值时，只输出结构/观察；后者允许输出 `demoDistributionDistance`，不可命名为 GTO 评分。

分布距离固定为 `sum(w_h * TV(p_h,q_h)) / sum(w_h)`，其中 `TV=0.5*sum_a(abs(p-q))`、概率换算为 0..1，h 仅遍历 targetScope。缺少目标分配先报 incomplete，不把空值当零；总权重为零返回 unavailable；不同动作集合先核对分组映射，否则拒绝比较。范围来源和忽略 matchups 的限制随结果保存。

EvaluationPolicy T1-EP01 的 facets：structure、conceptAnswer、demoDistribution、reasonEvidence、strategicEV。最后一项对两个教学包固定 unavailable；理由文本不做自然语言正确性评分。选项式条件题/事实题使用明确答案键。

评价必须引用 package/definition/输入/Attempt/policy 的版本和哈希。概念题多字段逐项反馈，允许部分正确，不混成战略总分；金额按内部整数单位比较，5.5 与 5.50 的输入等价。解释文本不因为命中某个词就算正确。规则或内容更新只创建新制品，不覆盖旧评价；缺版本只能只读查看旧记录与原反馈。

## 8. Agent 工具能力

| 教学状态 | 允许工具 | 拒绝/需显式转辅助 |
|---|---|---|
| 未提交独立题/测验片段 | 输入投影、通用术语、保存用户主动输入 | 完整参考、未来节点、目标知识答案、自动应用参考 |
| 用户请求提示 | 当前级别 hint 命令 | 跨级自动展示全部答案 |
| 提交后 | 已揭示证据、配对对照、解释模板、复习计划 | 无数据时编造策略原因/EV/掌握度 |
| 自由研究 | 原研究命令和固定内容引用 | 绕过暴露入口获取课程关联答案 |

新 trace refs 支持 lessonRun、teachingAttempt、evidence、experiment、reviewItem。脚本产物有真实对象 ID；旧 Mission refs 不失效。预算/暂停/取消/中断幂等沿用旧约定，不为教学另建一套假操作。

## 9. 迁移与本地复测

选题须匹配目标、包版本和先修条件；先剔除缺内容/重复作答，再用暴露键判新题，最后按错误候选优先和稳定 ID 排序。语义上是原题的克隆不能当作新题。池耗尽为正式结果，不随机改花色生成未审核答案。

ReviewItem 默认总结完成 +24h，dueAt UTC。当前应用时钟可注入；测试用假时钟，不等待一天。演示“提前复测”只产生 preview Attempt，不满足 due，不更新真实延迟证据。无后端、不发通知，不创建桌面自动任务。

证据汇总按目标、内容身份、规则版本、原题/迁移/延迟、辅助和暴露分层。日期、题量或参考相似度不自动推导 mastery。难度或题集变化后不直接比较原始均分。

## 10. 存储与旧版兼容的明确选择

T1 使用 `WorkspaceSnapshot.schemaVersion=2`，TeachingState 自身为 version=1。**采用新数据库 `riverline-demo-t1`（DB version 1），原 `riverline-demo` 保留原样。** 这是本地数据隔离，不是新业务后台；避免旧 schema1 客户端无意剥掉新教学字段。

启动优先读取新库。只有新库尚无 current 且没有迁移完成标志时，才只读校验旧 schema1 快照，转换为 schema2 候选：原案例/版本/任务/作答 ID 保持、补 legacy 身份、TeachingState 初始化。新库在一次事务中写入 current、迁移来源摘要和原件备份，成功后才显示已保存。失败时旧库不动，候选留内存，重试不重复复制。

若新库 current 损坏，不偷偷回退到旧库并伪装最新数据；保留两份原件导出入口和明确内存模式。旧库损坏时不强制迁移，按原件恢复路径处理。

回看旧 Git 基线仍读旧数据库，只能看到迁移时之前的旧版历史；不会看到新教学成果。旧版之后产生的修改不自动合并到新库，用户可导入为新副本。回滚代码不等于回滚/合并浏览器数据，README 必须解释。

设置的“重置本应用全部数据”明确处理且只处理 `riverline-demo`、`riverline-demo-t1` 和本应用偏好，并告知保留旧库将导致下次自动再迁移。运行任务先取消，重置后新建 workspaceId；其他应用数据不得清除。原件导出始终可先执行。

## 11. 导入、导出和版本缺失

导出 schema2 包包含用户对象、引用的确切内容/规则版本、暴露、评价、复习和来源。内容包有答案时导出前记录 possible-exposure，并让本次导出包含这条事件；说明文件含答案。原始损坏数据下载只做原件恢复，不解释为可靠教学包。

导入先支持 schema1→schema2 转换与 schema2 校验，inspect 不改工作区。确认导入建立新副本：重映射 owned IDs/父子/任务引用；内容地址、canonicalExposureKey 和输入语义不随副本改名。seq 在目标空间重新分配并保留来源顺序，原截止序号映射到相应事件；不得沿用可碰撞的本地 seq。

校验哈希只是完整性检查，不是可信签名。导入作者自报“审核通过”不提升资格；与内置已知版本完全匹配的资产可复用，未知内容只作为 imported-demo/read-only，缺依赖阻止新的求解/评分。包里有答案或历史不全，暴露按 seen/possible/unknown 归并，取保守状态，不清空旧记录制造新题。

移除内容版本需先检查引用；被 run/Attempt/评价引用的版本保留只读。停用后不能新建 run，现有未完成 run 为 blocked/read-only，原已提交记录仍可查看；恢复同版本后才可继续，不能偷换新版。导入/版本升级的任一错误不部分写入现有数据。

## 12. 关键机制验证清单

- 输入、题目、政策、预测、作答与评价固定绑定；相同内容改名不创造未见身份。
- UI/Agent/知识/研究/导出遵守同一暴露入口；未来信息和答案侧信道不进入安全投影。
- 提示记录/辅助/返回证据有事务顺序；提交后的揭示不污染首次快照。
- 局部评分只算目标，给定/参考不计用户作答；空分母/未知不等于零。
- 连续片段按实际行动走，金额账本正确；省略动作与不合法不同，未覆盖不编造。
- 新库迁移只读旧原件、失败可重试，schema1/2 导入及 owned ID/seq 映射不丢关系。
- 假时钟推进、due 与 preview 分离；未知历史不计未见迁移或延迟掌握。
- 旧 D01–D08 的主要命令与旅程保持可用，旧数值仍标原合成身份。

## 13. 理论检索与引用补充合同

TeachingState 增加 KnowledgeState 或同层规范化 knowledge 聚合，保存 topic/concept、source/revision/locator、claim/relation、researchTask、coverageGap、indexManifest、retrievalRecord 和 citationBundle。索引是已发布知识的派生视图，可重建，不决定主张真伪。

知识主张与来源是不可变版本地址，导入不因复制改名清除语义引用；owned researchTask/用户反馈/检索记录等 ID 可重映射。旧 K01–K08 保留 legacy 来源身份和旧引用，只有实际拆解核对后才能建立新 claim 映射，不批量补造审核记录。

`searchTheory` 接收 query、allowedContext、lesson/attempt refs 和 indexVersion，返回候选、条件状态、排除原因及 RetrievalRecord。独立题的结果投影不能包含目标答案标题/摘要/来源细节。命令返回的记录不得包含被拒绝的完整答案正文以供 UI/Agent 偷看。

`checkTheoryApplicability` 使用主张已声明的条件做 match/conflict/insufficient-context/general-background 判定；不能用相关性分数取代。`buildTeachingCitationBundle` 只能引用当前允许、未撤回且有已核对支持边的 claim/locator，并把通用背景与数值依据分开。它检查引用和资格完整性，不声称自动证明自然语言命题。

来源查找/草稿/定位/核对/发布/撤回命令见知识规格，写操作沿用 commandId/expectedRevision 与原子快照。资料文本是待处理数据，不可定义新工具或执行命令；本地 UI 按文本展示内容，不能把来源正文作为可执行 HTML。

打开外部整篇来源或导出含答案知识包前，记录已知相关 scope 的 possible-exposure；不假定只读当前锚点。知识新版本不能重算旧 Attempt 的解释，缺失/撤回使新引用受限，旧证据只读保留和标状态。数据仍落 T1 独立库，无额外真实知识服务。
