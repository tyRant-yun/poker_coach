> 历史记录：整理前的设计/交付状态，不作为当前开发指令。当前能力见[最新状态](../../current-status.md)；原始版本可从Git提交 `f416438` 追溯。

# 参考产品与 GitHub 研究

研究日期：2026-11-12（Asia/Shanghai）。范围：官方帮助文档、GitHub README 和选定源文件。没有安装运行参考应用，没有登录付费产品，没有独立验证性能、数学正确性或 README 中的商业宣传。

研究用于提炼体验和接口需求，不复制代码、品牌、截图、策略数据库或受限内容。正文“借鉴/取舍”为本项目设计判断。文件级 blob SHA 及读取范围见 [来源索引](../../research/source-index.json)；它不是提交 SHA，也不保证今后的默认分支内容不变。

## 1. 研究比较

| 参考 | 已核对内容 | 对 Demo 的启发 | 不沿用的部分 |
|---|---|---|---|
| 旧 Riverline | README、前轮架构与复盘文档 | 保留节点、范围、来源与教学关联的概念 | 不复制人机牌桌壳，不引入旧后端 |
| GTO Wizard | Range Builder、Custom Solutions、Nodelocking 官方指南 | 完整范围编辑、提交比较、研究参数、局部锁定、训练出口 | 不仿制视觉，不复用数据与定价，不假定其内部架构 |
| Desktop Postflop | README、`src/invokes.ts`、`src/result-types.ts` | 编辑与计算接口分开；区分玩家、机会与终局节点 | 不引入 Tauri/Rust，不把路线图当已交付功能 |
| WASM Postflop | README 前 135 行 | 浏览器工作台可以承载专业研究信息 | 不在 Demo 内做 WASM 计算，不采信跨产品速度排行 |
| TexasSolver | README | 输入配置、计算过程和结果导出可形成清楚的流程 | 不编译 C++，不把作者基准当我们的指标 |
| GTO Trainer | README 前 135 行、`src/App.tsx` | 快速进入训练，范围整体可见，标明数据类型 | 不移植自研算法，不扩大成完整翻前求解项目 |
| PokerGTO Trainer | README、`src/renderer/App.tsx` 前 125 行 | 功能覆盖检查、延迟加载路由和本地演示数据入口 | 不照搬大量独立菜单，不采信“覆盖率/引擎数量”质量主张 |
| PokerKit | README.rst 前 110 行 | 规则裁决与研究展示应分离 | 当前只做 RulePort 脚本，不接 Python |
| Hand History Parser | README 前 125 行 | 原文与结构化玩家/行动模型分离 | 当前仅支持内置手牌和自有 Demo JSON，不宣称通用解析 |

## 2. GTO Wizard：重点借鉴业务闭环

[Range Builder 官方指南](https://help.gtowizard.com/how-to-use-the-range-builder/)描述按局面构建全范围策略、组合或类别编辑、锁定、撤销、提交及逐组合比较。对本项目最重要的启发是：把编辑结果变成可检查的作品，反馈能落回具体组合。

[自定义求解指南](https://help.gtowizard.com/how-to-build-custom-solutions/)把范围、底池、筹码和树编辑放进研究输入。Demo 应让这些条件在提交与结果中连续可见，而非将 Solver 做成孤立按钮。

[Nodelocking 指南](https://help.gtowizard.com/how-to-use-nodelocking/)展示组合/频率约束和前后比较。我们借鉴“指定锁定范围→运行→对照”的过程，但不假定任何产品文档中的精度、速度或阶段限制是本产品的真实能力。

设计取舍：参考差异、固定对手收益与对手可调整时的评价分开；不把一个相似度分数当成全部策略质量。

## 3. Desktop/WASM Postflop：重点借鉴结果模型

[Desktop README](https://github.com/b-inary/desktop-postflop/blob/main/README.md)说明其与 WASM 版本的关系，并明确暂停该开源项目开发。其路线图不能作为功能已经存在的证据。

[调用接口](https://github.com/b-inary/desktop-postflop/blob/main/src/invokes.ts)区分范围操作、树配置及后端调用；[结果类型](https://github.com/b-inary/desktop-postflop/blob/main/src/result-types.ts)区分玩家、机会、终局及多个展示模式。这支持我们将“节点导航”和“结果视图”作为独立契约，而非把所有输出压成一段文本。

[WASM README](https://github.com/b-inary/wasm-postflop/blob/main/README.md)说明浏览器求解应用定位，并包含作者历史比较。当前研究不复述或采用其性能结论。

设计取舍：本期使用同形状的 MockSolverAdapter；未来集成需要另做维护状态、能力、平台和使用条件评估。本次未实施引擎选型。

## 4. TexasSolver：重点借鉴配置和导出边界

[README](https://github.com/bupticybee/TexasSolver/blob/master/README.md)提供 GUI/控制台入口及策略 JSON 导出说明。Demo 对应的用户体验是“保存规格、查看过程、保存结果、重新打开”。

未读取其完整调用实现或验证输出；当前不声称已经得到可直接集成的协议。README 中的对比和使用问答不作为本项目法律或性能结论。

## 5. 两个训练产品：区分集中体验与功能目录

[nicholaschan004/gto-trainer](https://github.com/nicholaschan004/gto-trainer/blob/main/README.md)强调训练后查看整个范围及标明数据来源。入口源文件仅挂载 Drill，这只证明入口组织方式，不证明训练质量。借鉴低摩擦进入和来源标识；不采用其自述算法结论。

[Wei-D-web/poker-gto-trainer](https://github.com/Wei-D-web/poker-gto-trainer/blob/main/README.md)提供较广的功能目录；[App.tsx](https://github.com/Wei-D-web/poker-gto-trainer/blob/main/src/renderer/App.tsx)可核对路由组件声明和演示数据 hook。借鉴覆盖检查和演示入口；不能仅据路由存在就认定所有功能已经成熟。

设计取舍：把 Solver、范围、比较和实验集中在同一案例工作台，通过训练/复盘等用户任务导航，避免为每个后台能力建立单独菜单。

## 6. PokerKit 与牌谱解析器：为未来保留接口

[PokerKit README](https://github.com/uoftcprg/pokerkit/blob/main/README.rst)介绍规则状态和牌型相关能力；[Hand History Parser README](https://github.com/poker-apprentice/hand-history-parser/blob/main/README.md)给出异步解析及结构化玩家/行动输出示例。

Demo 保留规则与导入端口，以脚本和自有数据实现。未知文本不会被伪装成已正确解析；研究假设与原始牌谱事实分开保存。

## 7. Demo 技术方向核对

[React 官方说明](https://react.dev/learn/build-a-react-app-from-scratch)描述使用 Vite 创建客户端应用，也提醒路由等能力需自行配置。[Vite 指南](https://vite.dev/guide/)列出模板与 Node 要求。

本项目选择客户端 SPA，是基于无服务端业务、需要本地演示的范围判断。首轮研究时已核对 Node 24.15.0、npm 11.12.1，当时尚未安装应用依赖。用户授权后的 D01 已创建应用并锁定依赖、运行构建，具体版本与结果见 `d01-delivery.md`。

## 8. 综合设计结论

1. 主流程必须“编辑作品→提交→反馈→修订→训练迁移”，不能停在结果展示。
2. 参考产品证明这些交互值得研究，不证明我们的产品已经有学习效果。
3. 局面、版本与来源作为全局上下文；不要在多个页面重新录入同一局面。
4. Agent 通过真实的本地命令操作同一作品，模拟的是推理与外部结果，不是操作本身。
5. 所有比较数据自行创作，保留合成标签；不下载参考产品的策略表。
6. 对真实 Solver/规则/解析器的接入仅定义未来映射，本次不集成，也不预先承诺只换适配器就足够。

## 9. 留待交互原型验证

- 三栏密度是否适合全范围编辑，哪些信息应按需展开。
- 按组合、按类别与按总频率编辑是否容易混淆。
- 用户能否理解三种评价的差异和覆盖范围。
- AI 的建议、独立分支执行与用户直接编辑是否保持可控。
- 单节点到多街计划、研究到训练的跳转是否顺畅。

这些是后续评审目标，本轮不要求用户逐项回答。

## 10. 商业 Solver 与教学产品专题（后续研究）

2026-11-12，按用户要求读取关联聊天并逐项核对 PioSOLVER、GTO+、GTO Wizard、Simple Postflop、Simple GTO Trainer、HRC、MonkerSolver、FlopzillaPro 的官方资料。研究结果见 [逐产品分析](solver-teaching-research.md)，教学旅程、内容资格、评价、Agent 和 DDD 调整见 [教学产品方案](teaching-product-redesign.md)，证据与访问限制见 [专题来源索引](../../research/solver-teaching-sources.json)。

本次是文档研究，没有安装运行参考产品、读取付费策略库或修改应用。建议功能 TE01–TE08 尚未实施；当前 Demo 的合成参考只验证流程，不具备真实 GTO 教材资格。PF01/PF02 翻前反馈已纳入新方案的候选主线，Hero 自定义尺度和混频仍暂缓。

## 11. 理论知识建设的来源起点

用户新增理论完整查找与知识库要求后，已补充 [知识库设计](teaching-v2-knowledge-design.md)，并核对少量官方概念文档/具名教学文章作为来源起点，见 [5 份设计来源记录](../../research/knowledge-design-sources.json)。它们说明术语、条件与引用边界，尚未成为带定位/审核的实际知识条目；不能把这次登记视为 36 主张/12 来源的首批建设已达标。
