# Demo 模块、集成与状态设计 v0.2

状态：D01–D08 已实现并通过本地 Demo 验证；原设计名称与实际源码映射见第 12 节。目标是小型模块化前端，不搭建微服务、消息中间件或真实业务后台。

## 1. 技术方向

- React + TypeScript + Vite，客户端单页应用。
- npm，脚手架时固定依赖并提交 `package-lock.json`，不混用锁文件。
- React Router 处理页面和案例参数；本地浏览器展示。
- Zustand 承载规范化工作区状态，React 局部状态处理瞬时交互；业务修改经应用命令执行。
- CSS Modules/设计变量、语义 HTML 和 SVG 图表；图标按需使用轻量库。
- IndexedDB + idb 保存用户案例与制品，localStorage 只保存小型偏好；fixture 随包发布。
- Zod 校验导入、快照和适配器结果；领域语义另行检查。
- Vitest 验证关键状态机制；Playwright 验证完整旅程。框架版本和可用浏览器在获准开发后核实。

已确认的选择与取舍见 [技术栈决策](technology-selection.md)，任务见 [第一版任务设计](demo-v1-task-design.md)。D01 实际实现见 [交付记录](d01-delivery.md)，后续包结构见第 8 节。

## 2. 模块与决定权

| 模块 | 决定什么 | 主要输入/输出 |
|---|---|---|
| Study | 案例、事实/假设修订、分支与上下文 | Case、SpotRevision |
| Strategy | 草稿、组合分配、覆盖、撤销/提交 | PolicyDraft、PolicyRevision |
| Solver | 模拟规格、作业状态、结果引用 | SolveSpec、SolveJob、SolutionArtifact |
| Assessment | 完整性、演示参考差异、示例报告适用性 | AssessmentSpec、AssessmentReport |
| Learning | 题目、可见性、提示、作答、复测记录 | Exercise、Attempt、SkillEvidence |
| Knowledge | 自写条目、来源链接、适用条件 | Claim、SourceRef |
| Review | 原文、脚本解析、行动前快照、提取节点 | ImportedHand、DecisionSnapshot |
| Agent | 脚本任务、步骤、预算、patch、成果引用 | Mission、ToolTrace、ArtifactRef |
| Demo Runtime | fixture、故障、速度、重置、持久化、导出 | DemoContext、WorkspaceSnapshot |

这些模块是前端逻辑边界，不对应九个部署服务。RulePort 位于共享端口层，只执行字段校验及预置行动转换，不实现完整扑克裁决。

## 3. 操作入口与依赖

```text
页面 / Agent 脚本
  → 应用命令与校验
  → 模块状态 + 固定版本
  → Port（stub/mock/local adapter）
  → 结果验证与来源标记
  → 领域制品登记
  → 页面、Agent 轨迹、报告共同读取
```

组件不直接选取 fixture 制造结果。Agent 不直接写 store，也不单独维护另一份策略。

关键命令：createCase、reviseSpot、editPolicy、submitPolicy、forkCase、requestSolve、cancelJob、requestAssessment、createExercise、submitAttempt、applyAgentPatch、restoreAsDraft、exportWorkspace。

命令返回成功或结构化失败；修改用 expectedRevision 检查并发。运行较长的模拟步骤前固定输入引用，完成时登记原输入，不强制替换用户当前页面。

## 4. 端口与模拟集成

| 端口 | Demo 适配器 | 未来真实集成位置 |
|---|---|---|
| RulePort | 输入字段检查 + 预置合法动作列表/时间线 | 规则引擎适配层 |
| SolverPort | 脚本生命周期 + 合成结果制品 | 求解服务/进程 |
| AssessmentPort | 本地结构/差异计算 + 已绑定的合成收益报告 | 固定策略求值/最佳回应等服务 |
| KnowledgePort | 本地关键词、标签、上下文匹配 | 内容库与检索服务 |
| AgentPort | 支持意图到任务脚本，不接模型 | LLM 规划与领域工具执行 |
| ImportPort | 内置样本识别 + 自有 Demo JSON 校验 | 特定牌谱解析器 |
| PersistencePort | 带 schema 的 IndexedDB 覆盖层与小型偏好 | 用户数据库与制品存储 |
| ExportPort | 浏览器 JSON/Markdown 文件下载 | 云端报告或共享 |

未来替换适配器时仍需重新验证语义、能力与性能；端口只减少耦合，不保证集成零改动。

## 5. 核心实体关系

- Case 引用当前 SpotRevision，并拥有研究分支引用。
- SpotRevision 固定规则条件、公开状态、范围版本、行动树版本和假设。
- PolicyDraft 绑定一个 SpotRevision 与节点；每次编辑生成递增草稿修订。
- PolicyRevision 是提交快照，固定组合分配和覆盖。
- SolveJob 固定 SolveSpec；SolutionArtifact 与输入 fingerprint 绑定。
- AssessmentReport 固定策略、节点、评价方法和参考制品。
- Exercise 固定输入、隐藏内容与评价约定；Attempt 固定独立/辅助状态。
- Mission 固定任务目标、执行策略、预算及输入版本；轨迹引用真实输出 ID。

用户反馈增量：Case 新增独立 HeroPlan 列表，绑定局面修订，记录具体手牌、当前行动与条件性后续计划；保存 HeroPlan 不创建 PolicyRevision，也不修改覆盖率。只读参考作业允许 policyRevisionId 为 null，直接固定局面输入；完整策略评价仍要求固定 PolicyRevision。显式参考补全的 assistance 来源随草稿、提交、恢复和导出保留。旧快照以默认空 HeroPlan 列表兼容加载。

使用 ID 引用，避免树中互相复制大对象。选中节点、面板、hover 等属于瞬时 UI 状态，不写进不可变业务版本。

## 6. 必须保护的不变量

1. 未填写、零概率、不在范围、死牌、不可达、未支持是不同状态。
2. 提交快照不能被后续草稿修改。
3. 训练视图及 Agent 工具只能读取当前允许的信息投影。
4. 已揭示答案的作答必须保留辅助标记。
5. 结果制品只适用于其绑定输入；相似不等于匹配。
6. 已取消任务不转成成功；重复请求不重复登记同一成果。
7. Agent 应用 patch 前检查版本；冲突时保留两方内容或创建分支。
8. 任一合成数值都带来源，导出不能丢失来源。
9. 缺失评价不是零损失，未覆盖不是失败作答。
10. 输入改动提示相关下游需复核，但保留历史版本和报告。
11. 当前不承诺全规则合法性；字段校验与扑克裁决有明确能力边界。

## 7. 状态机与恢复

策略：editing → submitted（固定快照）；继续修改创建新草稿，不能倒写 submitted。

作业：queued → preflight → running → postprocessing → completed；非终态可转 failed/cancelled；未达到精度目标为 completed 的独立 quality 状态。取消后清理定时器并拒绝迟到结果。

Agent：planned → running → completed / failed / cancelled；显式暂停为 paused。每步调用应用命令并记录结果；支持任务预算耗尽的停止报告，不伪造后续完成。

训练：ready → answering → submitted → feedback → next/completed；提示与揭示状态独立记录。

刷新恢复：业务快照保留；尚未完成的 mock 作业和任务改为 interrupted，不假装后台继续运行，用户可重放或重试。完成制品保持可查看。

## 8. 目录规划与实际子集

D01 当时创建 app、study/domain、strategy、shared、ports、mocks、fixtures、persistence、styles 和对应测试。下图保留最初目录规划；当前 knowledge、review、learning、agent 已按第 12 节实际文件落地。

```text
src/
  app/                 路由、全局上下文与应用命令
  modules/
    study/ strategy/ solver/ assessment/
    learning/ knowledge/ review/ agent/
  shared/              共享类型、卡牌、矩阵、抽屉、图表
  ports/               小型异步接口与结果信封
  mocks/               适配器、任务脚本、故障与虚拟时钟
  fixtures/            自写案例、范围、合成结果和理论条目
  persistence/         快照、schema、迁移、导入导出
  styles/              设计变量与布局
tests/
  state/               关键一致性检查
  journeys/            用户闭环
```

不要为每个 DTO 创建一个包。类型与逻辑先放在直接使用它的模块中；共享类型只保留跨边界必需部分。

## 9. 存储与演示可复现

fixture 不可修改；用户修改以覆盖层保存到 IndexedDB 数据库 `riverline-demo`，带 schemaVersion、fixtureVersion、savedAt 和独立用户状态。localStorage 的 `riverline-demo:prefs:v1` 只保存小型偏好。

案例元数据与相应修订应在同一存储事务中提交。显示“已保存”需要等待成功确认；失败时保留内存状态并明确提示。Zustand 不作为唯一持久化机制，定时器、hover 和原始 fixture 不写入持久化覆盖层。

损坏或版本不兼容时保留原始内容并提供下载与重置入口；配额不足时保留内存状态，提示未保存并允许导出。设置页说明本地保存不等于云备份。

“重置演示”只清理本应用命名空间，不清浏览器全部存储；先提供导出机会。重新导入校验大小、schema、引用和 synthetic 标签；不执行导入文本或 HTML。

场景、失败配置、播放速度与脚本由 DemoContext 固定；不使用随机网络结果。定时器可被测试时钟替换，用户可跳过等待。

## 10. 开发后的验证约定

- 对版本绑定、取消/迟到、训练隐藏、Agent 冲突、持久化恢复做关键机制验证。
- 对 J01/J03/J05/J08/J09 做端到端检查，其他旅程按交付覆盖。
- 视觉检查主工作台、矩阵编辑、结果比较、训练和任务轨迹在 1440/1280px 可用。
- 启动后产品运行不访问真实 Solver/模型/账户服务；本地开发服务器和构建资源请求不属于外部业务集成。
- 只在代码实际存在后报告 typecheck/build/test 状态。

## 11. D02 实际实现补充

- `StudyCase.ranges` 保存可编辑的 BTN/BB 输入权重；旧 D01/Hero 记录缺省时解析为原 S01 输入。每个新 `PolicyRevision` 复制双方范围，不借用当前案例范围。
- 频率仍以整数基点存储；输入权重与行动概率是不同字段。范围修订建立新的 `spotRevisionId` 和 `rangeVersion`，保留仍可用的分配，移除排除组合的分配，新组合待填。
- `editCase` 是草稿事务入口；分配、锁定、补全、清空、条件/范围修订和旧版恢复均登记一次历史。最近 30 步持久化，含条件、范围、分配、锁定、辅助来源和恢复来源；撤销/重做增加编辑序号，截断新编辑后的 redo，不修改固定版本、作业或报告。
- 锁定属于编辑保护，统一在应用命令中执行，Hero 套用与补全同样跳过锁定组合。它不是 D04 的 Solver Node Lock。
- 版本恢复产生下一编号的草稿；提交后形成新版本。`branchSource` 记录命名研究分支的原案例/版本，成果不复制改名，原报告留在原案例。
- `pendingInput` 仅为瞬时 UI 状态，不导出或持久化；路由阻塞和浏览器离开提示保护尚未应用的编辑。表单固定 `editRevision`，发生冲突保留输入，需显式核对或重新载入。保存失败/内存模式下也有浏览器离开提示。
- IndexedDB 数据库和 `schemaVersion: 1` 保持兼容；新字段为可选/默认值，不清除旧数据。生产构建按研究视图分块加载。

## 12. D03–D08 实际实现映射

本节覆盖当前实现；前文目录和通用信封是设计表达，不要求与最终文件名一一对应。

| 责任 | 实际位置 | 决定权 |
|---|---|---|
| 应用入口 | `src/app/workspace.ts` | 规范化状态、持久化调度、共用 commands/queries |
| 研究/节点/实验 | `src/modules/product/research.ts`、`ResearchWorkbench.tsx` | 节点草稿、上游复核、参考请求、Node Lock、固定基准 |
| 任务/求解 | `src/mocks/solver.ts`、`src/ports/index.ts`、`JobDrawer.tsx` | 固定输入、执行状态、质量、取消/重试 |
| Agent | `src/modules/product/agent.ts`、`AgentPanel.tsx` | 3 条脚本、预算、工具轨迹、revision 冲突与恢复 |
| 训练 | `src/modules/product/learning.ts`、`LearningPages.tsx` | 题目投影、辅助状态、不可变作答、迁移与计划 |
| 知识 | `Knowledge.tsx`、`src/fixtures/scenarios.ts` | 8 条作者内容与来源、精确条目跳转 |
| 复盘 | `review.ts`、`ReviewPage.tsx` | 原文、待确认字段、行动前投影、节点提取 |
| 导入/导出/恢复 | `transfer.ts`、`DataTools.tsx`、`Settings.tsx` | 校验、复制和 ID 重映射、隔离未验证证据、重置 |
| 内容/模式 | `src/fixtures/scenarios.ts`、`product/domain.ts`、`persistence/schema.ts` | S01–S10、学习/任务/手牌数据与持久化边界 |

研究、学习、Agent、复盘和迁移命令工厂通过 `ProductContext` 复用核心命令；UI 不导入 fixture 取业务结果。实际类型为 `StudyCase`、`SolveJob`、`SolveResult`、报告、会话和 mission 等，输入、版本、来源分布在这些强类型对象中；未另建一个名称完全相同的通用 `DemoResult` 包装层。

`Spot` 允许街道、当前行动方、预定义行动集合、数值单位、假设和上游标记；范围支持附加玩家，旧 S01 的隐式行动集合保留。节点草稿按 nodeId 暂存，切换不改写历史版本。提交包含当时 Spot 和各玩家范围。输入 fingerprint 规范化实际范围/牌面/行动/树/假设，忽略随机 ID 和标题。

作业冻结输入与设置，重试旧作业仍用旧输入；跳过等待与取消分别处理，取消拒绝迟到结果。刷新未完成作业/Agent 为 interrupted，恢复步骤先查已产生成果，避免重复提交/求解。全局任务入口始终可打开固定版本结果。

训练视图由命令层投影，揭示前不返回参考答案和未来信息；首次 Attempt 固定，提示/揭示导致辅助标记持续保留，反馈后的修改保存为新 Attempt。复盘玩家视图不返回全知原文、未来牌/行动或对手私牌，显式切全知才提供。

`WorkspaceSnapshot` 保留 schemaVersion=1，以 optional 字段增量兼容 D02；S01 旧内容不变，fixtureVersion 维持原值。导入另做领域引用与输入一致性校验，在同一快照内复制并映射对象关系；缺 fixture 的数值只保存在未验证档案。IndexedDB 损坏后只读保留原内容并进入内存工作区；下载原件和明确重置是两个独立操作。

页面按需加载，依赖另分 vendor chunk；1024 折叠侧栏。持久化、导入与 UI 投影的关键不变量由 57 项状态测试及 20 条浏览器旅程组合验证，详见 [交付记录](demo-v1-delivery.md)。

## 13. T1 教学升级的后续设计

教学核心、暴露/评价、命令与 schema2/独立本地库的设计见 [T1 领域合同](teaching-v2-contracts.md)，任务见 [T1 任务设计](teaching-v2-task-design.md)。这些是未实现的新设计，不代表当前数据库已迁移或当前 API 已存在；第 12 节继续准确描述当前应用。

T1 v0.2 新增独立 Knowledge Context，理论查找/建设、来源定位、主张适用性、检索记录和逐主张引用见 [知识库合同](teaching-v2-knowledge-design.md)。Knowledge 只拥有依据与引用资格，Learning 拥有答案暴露，Solver 拥有数值结果，Agent 编排调用；新能力均未实现。
