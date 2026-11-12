# Demo 模块、集成与状态设计 v0.1

状态：设计合同，未实现。目标是小型模块化前端，不搭建微服务、消息中间件或真实业务后台。

## 1. 技术方向

- React + TypeScript + Vite，客户端单页应用。
- npm，脚手架时固定依赖并提交 `package-lock.json`，不混用锁文件。
- React Router 处理页面和案例参数；本地浏览器展示。
- React Context/reducer 或小型状态存储承载规范化数据；先不用服务端缓存库。
- 原生 CSS/设计变量、语义 HTML 和 SVG 图表；图标按需使用轻量库。
- 浏览器本地存储保存小型用户覆盖层，fixture 随包发布。
- Vitest 验证关键状态机制；Playwright 或可用浏览器工具验证完整旅程。框架版本和可用浏览器在脚手架时核实。

当前不创建源码、安装依赖或启动服务。暂定包结构见第 8 节。

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
| PersistencePort | 带 schema 的本地覆盖层 | 用户数据库与制品存储 |
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

## 8. 拟议目录（尚未创建）

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

fixture 不可修改；用户修改以覆盖层保存到 `riverline-demo:v1` 命名空间，带 schemaVersion、fixtureVersion、savedAt 和独立用户状态。

损坏或版本不兼容时保留原始内容并提供下载与重置入口；配额不足时保留内存状态，提示未保存并允许导出。设置页说明本地保存不等于云备份。

“重置演示”只清理本应用命名空间，不清浏览器全部存储；先提供导出机会。重新导入校验大小、schema、引用和 synthetic 标签；不执行导入文本或 HTML。

场景、失败配置、播放速度与脚本由 DemoContext 固定；不使用随机网络结果。定时器可被测试时钟替换，用户可跳过等待。

## 10. 开发后的验证约定

- 对版本绑定、取消/迟到、训练隐藏、Agent 冲突、持久化恢复做关键机制验证。
- 对 J01/J03/J05/J08/J09 做端到端检查，其他旅程按交付覆盖。
- 视觉检查主工作台、矩阵编辑、结果比较、训练和任务轨迹在 1440/1280px 可用。
- 启动后产品运行不访问真实 Solver/模型/账户服务；本地开发服务器和构建资源请求不属于外部业务集成。
- 只在代码实际存在后报告 typecheck/build/test 状态。
