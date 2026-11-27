> 历史记录：整理前的设计/交付状态，不作为当前开发指令。当前能力见[最新状态](../../current-status.md)；原始版本可从Git提交 `f416438` 追溯。

# 第一版 Demo 实际交付记录

日期：2026-11-12（Asia/Shanghai）。状态：D01–D08 已完成本地 stub/mock 范围的整版验证。本次按用户“单次内尽可能多完成”及“开始”，从 v0.2 计划连续推进 C1→C2→C3，没有在单张任务卡后结束。原 [任务合同](demo-v1-task-design.md) 和 [产品范围](product-design.md) 保留。

## 1. 实际交付

| 工作包 | 已完成行为 |
|---|---|
| C1：研究工作台 D03/D04 | 参考优先浏览、全范围与 Hero 联动、统一双牌面、节点/发牌探索、多视图；固定输入作业、故障/质量/取消重试；上游复核、Node Lock、固定基准与两种假设报告 |
| C2：Agent/学习 D05/D06 | 8 条知识、3 条脚本调用实际命令；新分支/报告/训练计划；冲突/暂停/取消/恢复；四类完整练习、独立/辅助、不可变作答、S03 迁移与证据 |
| C3：复盘/整合 D07/D08 | 完整/缺失手牌、行动前视角、确认字段、提取研究/练习；翻前/三人/MTT 预览；报告检索、收藏最近、设置、JSON/Markdown、导入新副本、原件恢复、重置重播 |

D01/D02 的范围编辑、批量混频、锁定、撤销重做、输入权重、固定版本比较与分支已保留并回归验证。Hero 可从一手牌思考行动，再联系全范围；完整范围填写并非浏览参考的前置条件。

内容资产：S01–S10，各自有适配输入；K01–K08；AT01 改进分支、AT02 对照实验、AT03 训练计划；四类可完成练习；完整/缺失手牌和导入异常恢复。具体数据由本项目自写，没有复制其他 Solver 的策略表。

## 2. 推荐演示路线

按 [README](entrypoints/README.before-consolidation.md) 启动 `npm run dev`，打开 `http://127.0.0.1:5173/library`。无需账号、密钥或业务服务。设置可用快速模式缩短模拟等待。

1. **参考与节点**：打开 S02 → 模拟节点参考 → 选牌类与具体两张牌 → 切换策略/权益/动作 EV/范围视图 → 依次探索三条行动/发牌延续。未知后续牌保留为未覆盖；修改上游查看下游需复核。
2. **编辑与版本**：进入全范围构建 → 多选/锁定/批量混频/撤销 → 明确补全 → 提交 → 模拟 → 两版比较/恢复新草稿。Hero 页可单手推演并选择辅助补全。
3. **假设实验**：S06 → 载入并固定基准 → 建立过度弃牌和偏多跟注假设 → 分别求解 → 并排查看固定版本、Node Lock 和合成报告。理论页可进入实验，记录有条件笔记。
4. **Agent**：研究页打开助手 → 选择改进分支、对照实验或训练计划 → 查看步骤/预算/真实成果跳转。“仅建议”不修改案例；执行模式产生可继续编辑的分支。任务中心可恢复或取消。
5. **训练**：计划转题组或从训练中心进入四类题 → 实际作答 → 提交反馈 → 辅助修订/S03 迁移 → 学习记录打开固定 Attempt。提示或揭示后身份持续标记为辅助。
6. **复盘与预览**：导入内置手牌 → 在行动前节点查看公开信息 → 明确切全知模式 → 提取研究/练习并返回来源。缺失样例先确认字段；未知文本仅待整理。S08/S09/S10 可改配置并查看匹配边界。
7. **备份与恢复**：导出 JSON/Markdown → 在设置明确重置本应用 → 导入备份预检并创建新副本 → 检查版本/报告/题组/手牌关联。故障设置可演示失败重试、资源限制、质量不足；全局求解任务能定位旧输入和报告。

## 3. 功能覆盖与实现证据

以下是可观察行为映射；测试组合验证关键机制和旅程，不宣称自动化穷举全部 UI 操作。路径相对于仓库根目录。

| 功能 | 可观察行为 | 主要验证文件 |
|---|---|---|
| F01 工作台/库 | 最近、收藏、10 场景、继续研究 | journeys/d01、product-complete |
| F02 局面/假设 | 条件与范围修订，未知输入保留 | journeys/d01、editor；state/research |
| F03 策略构建 | 矩阵/双牌面/批量/锁定/混频/撤销 | journeys/editor、hero |
| F04 连续策略 | 三条延续、节点隔离、上游复核 | journeys/research；state/research |
| F05 Solver | 状态、固定输入、取消/重试/质量 | journeys/research；state/runtime-safety |
| F06 评价 | 结构/参考差异/有条件模板 EV 分开 | journeys/d01、product-complete；state/research |
| F07 实验 | 固定基准、变体与报告，研究笔记 | journeys/product-complete |
| F08 剥削/锁定 | BB 指定组合频率、补全约定、两种假设 | journeys/product-complete；state/research |
| F09 知识 | 8 条知识、检索、来源、实验入口 | journeys/product-complete、learning-agent |
| F10 Agent | 三类任务、真实分支/报告/计划、冲突恢复 | journeys/learning-agent；state/learning-agent、runtime-safety |
| F11 训练 | 四类题实际作答、提交反馈、题组推进 | journeys/learning-agent、product-complete |
| F12 迁移/证据 | 固定首次作答、辅助修订、独立 S03、证据跳转 | journeys/learning-agent；state/learning-agent |
| F13 复盘 | 行动前/全知、缺失确认、提取与来源返回 | journeys/review-transfer；state/review-transfer |
| F14 版本 | 固定提交、比较、恢复新草稿、分支 | journeys/editor；state/editor |
| F15 成果迁移 | JSON/Markdown、复制导入、ID 关联、缺 fixture 档案 | journeys/review-transfer；state/review-transfer |
| F16 异常 | 取消拒迟到、重试、损坏原件、内存恢复 | journeys/research、product-complete；state/runtime-safety、review-transfer |
| F17 扩展预览 | 翻前/三人/ICM 各自配置、范围/单位/报告 | journeys/product-complete |
| F18 偏好/视角 | 四色、预算、教练/云端说明、行动前视角 | journeys/product-complete、review-transfer |

表内文件均在 `tests/`，补全扩展名：旅程为 `.spec.ts`，状态为 `.test.ts`。旧 D01 机制文件为 `state/workspace.test.ts`，覆盖总数以最终运行结果为准。

| 旅程 | 实际验证 |
|---|---|
| J01 研究→评价→修订 | d01/editor/hero 浏览器回归、固定报告与未知输入 |
| J02 连续策略 | research 浏览器节点探索 + research 状态测试的三路径/上游复核 |
| J03 Agent | learning-agent 浏览器成果跳转 + 状态测试三脚本/冲突/暂停取消恢复 |
| J04 对手假设 | product-complete 基准/两个假设/三报告 |
| J05 训练迁移 | learning-agent 独立/辅助/S03 + product-complete 四类 UI 完成 |
| J06 手牌复盘 | review-transfer 视角隔离、提取、原文/来源、缺失字段 |
| J07 理论→实验 | product-complete 来源/条件→关联实验→笔记 |
| J08 故障恢复 | runtime-safety 机制 + research 故障/重试/质量 + Agent 恢复 |
| J09 保存与扩展 | review-transfer 导出重置导入 + product-complete 三类预览/单位/损坏恢复/任务入口 |

## 4. 实际验证结果

最终稳定源码执行：

| 命令 | 结果 |
|---|---|
| `npm run build` | 通过，含 `tsc --noEmit`；Vite 生产构建通过 |
| `npm test` | 7 个文件，57 项状态测试全部通过 |
| `npm run e2e` | Chromium，20 条浏览器旅程全部通过，约 1.4 分钟 |
| `git diff --check` | 提交前执行通过 |

Windows 本地，Node.js 24.15.0。1440/1280 研究/范围操作与 1024 折叠布局已有旅程检查；关键组合键、关闭详情焦点恢复、离开未应用输入提示也已覆盖。指定旅程监测页面异常/外部请求，没有发现外部业务请求或必要远程资源。没有验证全部屏幕尺寸、移动端操作效率或原生窗口关闭提示。

重点机制包括语义 fingerprint、旧输入重试、取消拒绝迟到、独立/辅助投影、固定 Attempt、Agent patch 冲突/幂等恢复、用户实验编辑保留、旧 D02 数据兼容、导入引用映射、缺 fixture 隔离、损坏原件与应用范围重置。修复了空 Hero 范围、节点结果视图切换、长 JSON 导入、Agent 自身 revision 与用户 revision 区分等边界。

## 5. 数据与恢复边界

- Snapshot 使用 optional 字段增量兼容旧 D02，原 S01 内容与 fixtureVersion 保留；不是破坏式 schema 升级。
- 每份作业保存固定输入/设置/状态事件；提交与报告固定版本，当前草稿修改不会改写旧成果。
- 导入默认复制，不覆盖原案例；对案例、版本、报告、mission、计划、Attempt、手牌及来源关系做 ID 重映射。损坏/不支持输入预检失败时原工作区不变。
- 缺 fixture 的旧数值封存为未验证证据，关联执行受限；保留用户输入，不借用当前样例。未知手牌不推断动作。
- IndexedDB 损坏时保留原件、显示内存模式，可下载原始内容；明确重置才清除本应用记录，不清其他应用数据。Git 与浏览器备份各有用途，均未上传远程。

## 6. 截图

截图来自实际本地浏览器旅程。D01/D02 历史截图不覆盖。

- [双牌面组合列表](screenshots/v1/combos-1440.png)
- [节点与范围研究](screenshots/v1/research-1440.png)
- [固定基准与两种假设](screenshots/v1/experiment-1440.png)
- [四类练习完成后的证据](screenshots/v1/four-exercises-1440.png)
- [缺失手牌确认与行动前提取](screenshots/v1/review-1440.png)

## 7. 明确限制与下一步评审

所有求解、权益/EV/可利用性、对手推断、Agent 推理与能力推荐均为作者编写的示例，未验证扑克计算正确性或真实教学效果。任意用户策略只能获得实际可计算的结构/参考差异，配对模板之外不提供伪造收益。

Agent 识别三条脚本及受限提示意图，不具备任意语言推理；暂停在当前工具完成后生效，取消阻止后续步骤并取消对应求解。已完成本地副作用不会因取消自动回滚。独立训练表示本次未调用辅助，不保证用户从未看过该局面。

手牌解析仅覆盖自写完整样例，缺失内容由用户确认；不是通用牌谱解析器或规则引擎。翻前/多路/MTT 是有完整本地操作的产品预览，不是真实求解。效用单位不与现金局混合，未支持评价保持未知。

教练和云端选择仅为产品说明，无真实认证、权限隔离、云执行或同步。Hero 自定义合法尺度与混合频率仍按用户明确许可暂缓，范围编辑混频保留。真实 Solver/LLM/规则引擎、支付、认证、云数据库、远程仓库和部署均未接入。

下一步为实际产品体验评审：参考优先的研究流程是否顺手、Hero 与全范围的联系是否清楚、训练辅助身份与固定版本是否可理解。生产架构与真实接口应在这轮体验结论后另立范围。

## 8. Git 交付

起点 `baseline/demo-v1-plan-v0.2`，C1 提交 `51a18ce`，C2 提交 `0a5deed`；C3、整合修复、完整检查与本记录在最终提交。`baseline/demo-v1-m2`、`baseline/demo-v1-m3`、`baseline/demo-v1.0` 在整版检查通过后共同记录最终提交，未移动旧标签。可用 `git show baseline/demo-v1.0` 核对最终 SHA 与差异。

未配置远程、未推送或部署。无损回看见 [Git 工作流](entrypoints/git-workflow.before-consolidation.md)。
