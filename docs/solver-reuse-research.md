# Solver 理解与复用方案 v0.1

日期：2026-11-12。用户最新要求：“参考一下成熟solver实现，尽量采用理解+复用的模式”。这是 S1 的补充设计；覆盖此前“不复制外部代码”中可能被理解为一律自行重写的限制。后续优先固定版本依赖/受控 fork，不做无来源的零散复制。

后续 v0.3 约束修订：真实适配必须使用 [唯一本地运行时与 MCP 合同](solver-s1-mcp-runtime.md)，不另建引擎工作区。R1 额外记录 OS/架构/工具链/CPU/RAM/线程、采用方式和补丁、金额/EV/组合索引与独立基准；“设计借鉴/已验证复用/未验证能力”分别记录。目前仍仅源码初筛，无编译或运行证据。

## 1. 本次实际做了什么

已通过官方仓库阅读范围、建树、求解循环、节点解释器、存档、桌面命令桥与命令行文档；用 GitHub API 获取研究版本，并读取固定 commit 下的关键接口。未克隆、编译、运行第三方求解器，未加入产品依赖；以下为源码级初筛，不是正确性/性能/生产成熟度认证。

| 研究对象 | 已取得的版本 | 本次深度 |
|---|---|---|
| b-inary/postflop-solver | `9d1509fe5077d019825f833eed04b16d342dfda1` | 重点核对，固定版本接口与参数、策略布局、缓存/锁定生命周期 |
| b-inary/desktop-postflop | `0c15f97f204e5533b09cd83fda5939c110a98e75` | 核对桌面命令注册及 solver 命令层接口 |
| bupticybee/TexasSolver console | `02c8021ee1307c18aa1e76b772c6ae1451601bc6` | 读取 console 分支命令行文档；本次未深入其 C++ 核心 |

网页缓存可能与最新分支行号不一致，本文以固定 commit 链接和符号为准。TexasSolver commits API 首次返回 422，随后通过 git ref API 取得 console SHA；没有把失败请求写成验证通过。

## 2. 主候选与复用边界

**主候选：postflop-solver；产品桥参考：Desktop Postflop；第二候选/交叉检查：TexasSolver。**这是基于已见接口覆盖与现有产品需要的设计选择，最终采用取决于 R1。

postflop-solver 已有范围、树、求解、查询与序列化边界，适合保留完整计算内核。我们开发适配器、产品版本/任务、结果投影、教学与暴露流程；不在 TypeScript 中重写 DCFR、手牌评估、花色同构或内存压缩。

源码的求解循环明确在两个玩家间更新；树只包含 Flop/Turn/River。不能通过把玩家数组改成六个就声称支持六人翻前。HU 翻前、六人翻前及多人翻后仍单独选型；bunching 是已弃牌玩家条件，不是多人决策支持。

作者已声明暂停开源开发，库 README 还说明可能不改版本号就发生破坏性变更。因此真实采用必须固定 commit，并保存自有适配器回归；不能只依赖 package 版本或 main 分支。来源：[README](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/README.md)、[求解核心](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/src/solver.rs)、[行动树](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/src/action_tree.rs)。

## 3. 源码到产品能力映射

| 原实现/入口 | 理解要点 | 复用方式/本项目工作 |
|---|---|---|
| Range；`range.rs` | 1,326 组合浮点权重，支持手牌类/具体组合、加号/区间/权重语法 | 真实适配侧直接使用库解析/序列化；前端保留现有组合编辑；建立显式双向索引，不用数组序推测同手牌 |
| CardConfig、TreeConfig、ActionTree | 双方范围与牌面、分街双方尺寸、抽水、全下阈值和相近尺度合并分别配置 | 复用建树；保存原始配置与实际展开树。显式控制自动全下/尺度合并，不能偷偷改变用户要求 |
| solve / solve_step / finalize | 已有完整求解与单步入口；质量计算和最终化分开 | 复用算法；由任务外壳调度 step、检查取消和预算，记录进度；单次 step 内不能假定可即时取消 |
| memory_usage / allocate_memory | 构建、估算与分配分阶段 | 分配前做资源判断；不靠申请失败后静默缩树。压缩模式记录在执行配置中 |
| private_cards、strategy | 返回顺序是引擎私牌顺序，策略是 action-major 扁平数组 | 适配为 node/player/combo/action DTO；不把原数组直接发给范围矩阵 |
| apply_history、possible_cards | 查询对象具有可变当前节点；机会节点有花色同构表示 | 每次用固定根＋历史定位；同会话串行访问或独立游标；不把同构代表牌当完整发牌菜单 |
| weights、normalized_weights、equity、expected_values/detail | 权重和数值查询各有条件；节点变化后需要更新缓存 | 原值、定义、可用状态一起返回；范围全局质量、兼容组合质量、显示比例分别命名 |
| lock_current_strategy | 按私牌列锁定，正数会被归一化，某列全非正表示未锁定 | 产品端先检验合法完整分配；转换显式 mask，防止把“没填”意外当成锁定/解锁；新建可求解实例再应用约束 |
| file.rs | 原生格式含 magic/version、压缩与数据类型，非产品 JSON | 复用原生存档；产品 envelope 保存引擎 commit、规格指纹和文件校验值。未验证前不声称能继续求解 |
| Desktop Postflop command bridge | 已有范围/树/内存/step/质量/结果分组命令 | 借鉴边界，复用引擎；不为使用它而把 React SPA 改成整套 Tauri/Vue 产品 |
| TexasSolver console | 参数文件驱动，运行后可导出策略 JSON | 作为另一个进程适配候选；另核对卡牌编码、树和指标口径，不能直接把 JSON 视为本项目合同 |

源码定位：[范围](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/src/range.rs)、[示例入口](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/examples/basic.rs)、[节点解释器](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/src/game/interpreter.rs)、[存档](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/src/file.rs)、[桌面命令注册](https://github.com/b-inary/desktop-postflop/blob/0c15f97f204e5533b09cd83fda5939c110a98e75/src-tauri/src/main.rs)、[桌面求解桥](https://github.com/b-inary/desktop-postflop/blob/0c15f97f204e5533b09cd83fda5939c110a98e75/src-tauri/src/solver.rs)、[TexasSolver CLI](https://github.com/bupticybee/TexasSolver/blob/02c8021ee1307c18aa1e76b772c6ae1451601bc6/README.md)。

## 4. 对接口合同的具体修正

1. **组合映射是第一项集成检查。**保存 engine card encoding、private_cards 双方索引及动作顺序；strategy 使用 `actionIndex × handCount + handIndex`。牌面冲突组合可能返回未定义值，投影应标 dead，不把异常浮点值当 0% 可用策略。
2. **“normalized”不是保证和为 1。**其源码注释表示兼容手牌的组合质量；展示比例必须另求分母，不能看到该名字就直接乘 100%。真实范围查询不得沿用 S1 自身路径传播的简化解释。
3. **不要降低引擎精度。**整数万分比继续服务用户编辑；引擎原始浮点频率/权重保留在来源制品，不写回编辑整数再算 EV。显示与编辑拷贝的取整是派生行为。
4. **浏览状态与固定解分开。**SolutionArtifact 不可变，查询会话可变；同一引擎实例上的两个面板不能无协调地 apply_history。游标不得作为永久 nodeId，永久引用含树版本＋语义路径。
5. **锁定发生在求解前。**该库锁定要求已分配且尚未 solved；不能对旧已完成实例直接写锁定并宣称重新求解。使用新建实例或经过验证的恢复方式，不修改原解。
6. **计算质量保留引擎口径。**solve_step 的循环迭代编号需连续，finalize、缓存和指标读取顺序按库要求；EV 的零点/投入/单位仍需数值基准确认，不凭方法名宣布已与产品口径一致。

以上是直接可落实的适配要求，不需要把整个引擎内部对象提升为产品公共模型。

## 5. “理解→验证→复用”的实施清单

| 顺序 | 任务与证据 | 所在批次 |
|---|---|---|
| U1 源码理解 | 记录固定版本、核心数据流、API 映射、限制与许可；每项准备一个最小输入和预期不变量 | 本文已完成初筛；S1 开发时落实 DTO 与契约样例，不运行引擎 |
| U2 独立复现 | 固定 commit 单独 checkout，检查构建依赖/许可，编译原示例，再跑一个小河牌树；保存资源、质量、输出 | R1；未执行 |
| U3 薄适配 | 优先 Rust 依赖＋小型本地进程外壳，版本化请求/响应；先规格/组合映射，再 step/取消，再查询/存档/锁定 | R2；未执行，不要求当前前端改桌面壳 |
| U4 验证复用 | 原生调用与适配器相同输入一致，卡牌/动作映射往返，查询并发隔离、存档恢复、锁定、取消实测；再用独立基准检查 | R1/R2；未执行 |
| U5 受控升级 | 引擎变更固定新 commit，记录差异与补丁，重跑代表树和合同；保留旧结果所需版本 | 实际采用后 |

引擎优先级：完整依赖 > 必要时维护有上游来源的 fork > 小范围可追踪补丁；自研计算模块需写明现有实现不满足的证据。不要先把 Rust 算法手工翻译成 TS，再声称完成复用。

R1 至少检查：组合/尺寸映射；概率和零权重；一步/多步与最终化顺序；范围聚合；牌面冲突；锁定后结果约束；时间/内存；取消的实际延迟；存档可读与可续算分别验证。确定性和误差阈值按浮点、线程与压缩配置预先声明，不能要求所有并行配置逐位相同。

## 6. 授权、许可与当前边界

用户的新要求确定“理解后复用”为开发原则，替代一律自行实现的解释。当前阶段继续做源码研究和设计调整；真实引擎编译运行/接入按 R1–R3 开发范围执行，本次没有因此宣称真实 Solver 已接入。

主引擎 [Cargo 声明](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/Cargo.toml)为 AGPL-3.0-or-later，桌面项目与 TexasSolver 同样需按固定采用版本核对。R1 产出依赖/修改/分发方式与许可要求记录；未来若闭源产品方案与许可不适配，评估可获得的其他许可或换引擎。不把本地进程、动态链接或网络边界当作自动豁免。

本次不引入代码、不改应用运行方式、不运行应用/引擎测试。已经读过源码与未来可以复用，均不等于已验证结果正确。S1 继续按合成结果运行；R1/R2 优先利用上述已有实现，HU/六人翻前另做真实能力验证。
