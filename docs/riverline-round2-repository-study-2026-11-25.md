# 第二轮：三个仓库的学习与复用裁决

日期：2026-11-25（Asia/Shanghai）。本轮为源码学习、现状复核与任务设计，没有实施下列改造。用户认可当前 UI 风格与“练习 / 复盘 / 研究”三个模块；本轮保留它们，重点解决动作缓冲、图形选牌、研究可视化与真实能力的实际可用性。

配套：[第二轮开发任务包](riverline-round2-task-design-2026-11-25.md)、[UI 与文字独立专项](riverline-ui-copy-optimization-task-2026-11-25.md)。第一轮实际交付仍见 [原交付记录](riverline-first-round-delivery-2026-11-25.md)。

## 1. 阅读基线与证据边界

| 仓库 | 本次固定版本 | 本次重点阅读 |
|---|---|---|
| 本地 `poker_coach` | `60191df` | `PlayPage`、游戏服务/规则 helper、共享卡牌、真实研究页面/合同/服务/原生读取、一般树适配和测试、旧范围可视化组件 |
| [旧 Riverline](https://github.com/tyRant-yun/riverline-poker-coach/tree/e449a35fb0b84dd13ab74d3dcde47034ac0cb294) | `e449a35fb0b84dd13ab74d3dcde47034ac0cb294` | 选牌器及测试、连续桌、播放队列及测试、简化桌面的接线、策略网格/聚合/组合详情/导航、Solver 适配/worker、事件重放 |
| [newHoldem](https://github.com/jianghao-jianghao-jianghao/newHoldem/tree/7744eb84999e1a53c0cc682d639cf3a86c9d448b) | `7744eb84999e1a53c0cc682d639cf3a86c9d448b` | 服务器行动调度、牌桌动作反馈、逐街全下、策略矩阵/研究面板、Solver 包装/同构缓存/输入脚本、范围实现、许可 |

两份远程默认分支通过 GitHub 接口重新核对，仍为上述提交。旧项目的本地检出版本不同，本报告的远程结论均以固定提交的文件为准。阅读与远程测试文件不代表这些仓库已在本机运行或其数值已验证。

本地另做以下现状复核：

- 运行中的 `real_capabilities` 返回 `installed: true`，固定引擎 `9d1509fe5077d019825f833eed04b16d342dfda1`，真实能力为一般 HU 河牌离散树；每方最多200个正权重组合、单计算槽。翻前、多人、转牌/翻牌与产品锁定实验未开放。
- 只读查询当前 `local` 工作区时，研究案例/作业/解均为0，未选中案例或解。因此用户当前入口确实没有可看的结果；不能用引擎已安装代替用户已获得研究体验。没有为这次复核向用户工作区写入案例或作业。
- 隔离复跑 `node --import tsx --test tests/solver/general-application.test.ts`，2项通过，实际运行一般树求解、深节点/返还/派生范围及恢复/损坏拒绝。这证明已有链路仍工作，不代表新增街道或下一轮任务已交付。

## 2. 牌桌为什么缺少节奏

当前 `runtime/game/service.ts` 的 `bots()` 一直推进到 Hero 再次行动或终局；`PlayPage.tsx` 收到结果后直接 `setHand(h)`。规则 helper 又会在行动后自动完成收池、发牌和结算。接口中的 `events` 主要记录玩家行动，没有独立的公共发牌/收池/派彩表现序列。因此一次请求可以跨过多名对手甚至多条街，用户只见最终状态。

| 来源与观察 | 可复用内容 | 必须修正的地方 |
|---|---|---|
| 旧版 [ActionPlaybackQueue][old-playback] 有可注入时钟、取消 token、思考/动作/停留阶段；comfort 为450ms思考+750ms阅读+150ms过渡，支持减弱动态与隐藏页处理 | 提取小型可测试播放器、速度设置、取消与过期回调保护；参数作为初始设计参考 | 队列播放的是动作摘要，牌桌筹码/公牌仍取最终 `table`，不能保证画面按时序推进 |
| 旧版 [CleanTableWorkspace][old-clean] 将 `onChange`、`onThinking` 接成空函数，并传 `reducedMotion={false}` | 作为完整旅程接线缺陷的回归案例 | 不能照搬此页面；单测队列存在不代表真实页面有动作反馈，也不能重新带入手中建议/频率 |
| newHoldem [服务器调度][new-server] 对 Bot 设置700–1800ms延时，以手牌编号/当前 actor 复核过期任务；全下每1150ms推进一街 | 学习“轮到谁→动作→发牌→结果”的分段与身份核对 | 本项目单用户已有原子行动批次，不为动画引入房间/WS/真人超时系统，不在 Node 业务队列里 sleep |
| newHoldem [PokerTable][new-table] 在座位旁展示动作，下注/全下/赢池有不同停留时间；取消独立计时器 | 轻量座位高亮、动作标签、投入筹码/收池/派彩反馈、结果停留 | 不迁入 Canvas喷泉/社交反馈/3D；不靠 `lastActionLabel` 文本变化识别事件，连续两次同名动作也须正确播放 |

采用方向：保留成熟规则与 Node 权威状态，在真实规则操作上生成安全的公共表现帧；客户端播放这些帧。客户端不推算筹码、不重发牌、不决定胜者。动画完成只决定界面何时开放操作，不成为新的规则或存储权威。

## 3. 图形选牌与范围输入

旧版 [CardPicker][old-picker] 已按四个花色展示52张牌，支持已用牌禁用、选择/关闭回调；[测试][old-picker-test] 覆盖52牌、死牌和回调。它是最直接的小组件复用候选。当前项目的 `src/shared/ui.tsx` 已有 `Card/Board/ComboCards/Dialog`，应在此基础上抽出共享选牌能力，沿用当前明亮 UI，避免引入旧项目全局 CSS。

复用不能只把文字输入换成52个按钮：

- 公共牌按槽位选择、替换、移除；Hero 观察组合用两个卡槽。文字牌码保留为高级批量入口，不再是必经步骤。
- 默认范围输入也须图形化：169牌类→具体花色组合→输入权重。否则用户仍要逐行填写 `AcAd:100`，问题并未解决。
- 两个范围允许含同一具体组合，求解时再对两手私牌不相交条件化；不能把 OOP 已选范围当作 IP 的全局死牌。
- 观察用 Hero 组合不等于把它锁成整个研究的唯一私牌。公共牌变化后，观察组合冲突应清除/重新选择，不把合法研究牌面挡住。
- 改公共牌造成已有范围冲突时，列出影响并让用户确认清理或取消；不静默删组合，也不把未解决的草稿当成可求解版本。
- 首期仍遵守200个正权重组合限制。图形编辑超限要保留草稿并阻止提交，不截断范围，不因UI做成169格就声称任意全范围可计算。

## 4. 研究结果：复用呈现机制，保留真实数值合同

当前 `RealAnalysisPage.tsx` 已有真实策略分段矩阵、范围占比、权益/EV数字、具体组合、行动EV表和节点按钮，但存在明显产品缺口：

1. 用户需依次保存→固定规格/预检→运行→手动打开解；无解时结果区完全不出现。
2. 默认及现有基准的范围很小，矩阵大部分空白；真实初始工作区还没有案例/解。
3. EV/权益主要是格内数字，没有相应色标/热图；整体行动分布是文本，Hero行动EV是表格。
4. 路径显示数字索引，缺少可读行动线与分支关系；页面超过1400行，输入、作业、查询与图表相互耦合。

| 来源 | 吸收方式 | 不带入的假设 |
|---|---|---|
| 本地 `ReferenceRange.tsx`、`RangeVisuals.tsx` | 复用牌类→花色组合联动、动作分段条/图例、可选动作视图的组件形态 | 原内容是合成策略，旧固定 action 枚举和样例数值不能接到真实结果 |
| 旧版 [StrategyGrid][old-grid]、[ComboInspector][old-combo] | EV/权益热图、清晰选中态、组合频率条、数值与单位；适配当前数据而非重建计算层 | 旧聚合按 `hand.weight`；当前需保持兼容私牌/当前路径条件分布，不能替换成简单组合计数平均 |
| 旧版 [SolverWorkspace][old-workspace]、[NodeNavigator][old-navigator] | 学习状态分段、当前组合联动 | 其模型只有 root/response 两节点，不能带回本项目一般树；不要照搬“独立容器”等工程文案 |
| newHoldem [RangeStrategyMatrix][new-matrix]、[GtoSpotInspector][new-inspector] | 视觉层学习：宏观行动分布、矩阵点选/悬停、固定组合详情、从手牌定位决策 | 其矩阵宏观权重有最小0.1补值，不能用于当前精确分布；更不能继承启发式评分和剥削增益 |
| 本地 `real-service/native-projection/native-access` | 直接保留固定规格、真实计算、质量、分页、兼容权重、派生范围和制品校验 | 不用旧远程桥替换现有已验证运行器，不把整个原生树放进工作区或上下文 |

所有图形消费同一 `solutionRef + path + player` 的真实查询。无数据、不可达、零概率、未达质量目标与数值0分别呈现。多下注尺寸保留各自动作身份，不能为了画四种颜色就合并策略。

## 5. 为什么不采用 newHoldem 的求解包装

此处是固定源码的直接观察，不是对整个项目的质量结论：

- [gtoSolver.ts][new-solver] 的结果元数据存在固定 exploitability 数字；TexasSolver 分支写入 `0.42` 和160次，而非读取该次实际质量。
- [gtoIsomorphism.ts][new-isomorphism] 的脚本内写死双方范围；缓存按底池/SPR桶、牌面/位置等构造，不包含本项目所需的完整双方权重、精确树与求解规格身份。
- 图表的数据可能来自启发式 workbench；其 node-lock 结果含人工构造的频率/增益，不能作为本项目真实锁定实验或 BR。

因此只吸收动作与图表的交互思路；数值继续使用本项目固定 postflop-solver。旧 Riverline 的 Solver adapter 有 flop/turn/river 字段和 sidecar 调度可读，但接口写了某街道不等于本项目已通过独立数值验收；只复用语义映射/测试思路。

## 6. 代码吸收与来源登记

| 裁决 | 内容 | 实施要求 |
|---|---|---|
| 原位保留 | 本项目 Node业务权威、PokerKit、Rust运行器、真实河牌合同/制品、独立基准、现有UI基调 | 先接可用旅程，不重写成熟规则/CFR，不产生第二后端 |
| 小模块提取后适配 | 旧选牌器、播放队列、热图/组合详情和相关测试用例 | 固定文件/提交、保留来源/许可，去掉旧Next/类型/全局样式依赖；测试真实消费者接线 |
| 理解后重新实现 | newHoldem动作节奏、2D筹码反馈、矩阵/行动条形图 | 记录参考；按本项目事件/查询合同实现，不复制整页与素材 |
| 不采用 | 两节点研究模型、旧简化桌面的空回调、启发式冒充真解、固定质量值、粗桶缓存、房间/认证/聊天/3D | 不为迁移方便重新带入原产品目标外的系统 |

源码许可已读取：旧仓库根为 AGPL-3.0，newHoldem 根为 PolyForm Noncommercial 1.0.0。本轮没有复制其应用代码。后续若实际吸收旧代码，逐文件登记来源和通知；newHoldem保持交互学习，避免把参考工程直接作为本产品可分发依赖。既有引擎采用/许可记录保持 `engines/postflop/THIRD_PARTY.md` 的原义。

[old-playback]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/features/table-v2/TableWorkspaceV2.tsx#L18
[old-clean]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/features/table/CleanTableWorkspace.tsx#L54
[old-picker]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/components/poker/CardPicker.tsx
[old-picker-test]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/components/poker/CardPicker.test.tsx
[old-grid]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/components/solver/StrategyGrid.tsx
[old-combo]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/features/solver/ComboInspector.tsx
[old-workspace]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/features/solver/SolverWorkspace.tsx
[old-navigator]: https://github.com/tyRant-yun/riverline-poker-coach/blob/e449a35fb0b84dd13ab74d3dcde47034ac0cb294/frontend/features/solver/NodeNavigator.tsx
[new-server]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/server.ts#L1043
[new-table]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/src/components/PokerTable.tsx#L224
[new-engine]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/src/shared/pokerEngine.ts#L1190
[new-matrix]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/src/components/RangeStrategyMatrix.tsx
[new-inspector]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/src/components/GtoSpotInspector.tsx
[new-solver]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/server/gtoSolver.ts#L496
[new-isomorphism]: https://github.com/jianghao-jianghao-jianghao/newHoldem/blob/7744eb84999e1a53c0cc682d639cf3a86c9d448b/server/gtoIsomorphism.ts#L173
