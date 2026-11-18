# 真实 Solver 工程规范与开发方法 v1

日期：2026-11-18。状态：计划采用，检查命令尚未全部配置。配套 [任务包](solver-real-task-design.md)、[代码库方案](solver-real-codebase-design.md)。

## 1. 每项能力的开发方法

按“读固定源码→列语义与不变量→准备小输入与独立预期→原生运行→薄适配→业务闭环→异常与资源验证→记录实际支持状态”推进。先为河牌建立可解释的 EV/BR 基准，再扩街；源码阅读、编译、运行、同源对照和独立验证分别记录。

每项任务交付 implementation、contract、verification、limitations 四部分。暂时没有数值依据的字段返回 unavailable，不先填近似结果等待后补。禁止为通过测试写真实输入到 fixture 的特判，禁止通过悄悄减树、改范围或降低精度使计算成功。

## 2. 代码约定

| 范围 | 要求 |
|---|---|
| TypeScript | 延续 strict、ESM、无未使用项；新增跨边界数据从 unknown 做 schema 校验，禁止 any/断言绕过；异步副作用集中在服务/适配层 |
| Rust | rustfmt 默认格式，clippy；业务边界使用 Result 和结构化错误；禁止把正常不支持/无数据变成 panic；自己新增代码不引入 unsafe，确需时提供不变量、范围最小化和验证依据，上游 unsafe 不作无依据重写 |
| 命名 | TS camelCase/PascalCase，Rust snake_case；类型显式表达 Money、ComboId、FixedRef、Probability、EV，不以普通 number 混用金额、概率和百分比 |
| 模块 | 纯输入映射、树/范围校验、调度副作用、查询投影分离；避免继续把原生逻辑塞入 service.ts；不以机械行数拆模块 |
| 数据 | 公共 DTO 不暴露上游对象、指针或可变游标；固定结果不可变，派生编辑创建新假设；浮点有限性和合法域逐边界校验 |
| 注释 | 写为什么、单位、条件与上游符号定位；复杂转换附小例子；不复制大段算法源码充当理解 |
| 错误 | code、message、field/path、retryable、details；区分 unsupported-input、budget-exceeded、quality-not-met、engine-failed、artifact-incompatible；日志带 request/job/attempt，不能泄漏答案到无权读取端 |
| 测试 | 命名说明输入条件与业务/数学性质；验证可观察行为；不以快照复制实现，不为纯文案加测试 |

TS 规范工具在 R2-A 对新增边界采用固定版本 ESLint＋typescript-eslint 和 Prettier，范围限定新增/修改模块，不做全库格式扫荡；版本由实际兼容验证后锁定，不预填未验证版本。Rust 工具链与组件由 R1 固定。跨平台统一 UTF-8、LF；依赖和 schema 修改与其消费者同批提交。

## 3. 数值与语义要求

- 金额必须有单位；动作必须明确 raise-to/增投；尺度写明根底池、行动前底池或其他分母；显示舍入不改变求解输入。
- EV 必须有玩家视角、节点零点、已投入/返还处理、抽水与评价分布。比较同一策略在不同分布下的 EV 不能直接产生策略优劣结论。
- 策略频率与范围权重不同；派生自身行动权重不冒充双方兼容组合下的真实条件概率。聚合要给分子、分母的语义及零分母状态。
- dead、unreachable、not-computed、unsupported 分开；NaN/Infinity 不能变成 JSON 零。若零到达节点返回引擎任意默认策略，必须标为不可作为质量证据。
- nodelock 后的解只声明相应约束问题的质量；锁定导致的偏离不能沿用无约束 Nash 质量解释。固定策略评价不称均衡求解。
- 不以混频差折算 EV 损失；等价最优策略可能不同。不同策略比较需共同固定评价器、对手/到达分布和 payoff 定义。

## 4. 验证分层与门槛

| 层次 | 验证内容 | 能证明什么 |
|---|---|---|
| 合同/性质 | schema 拒绝、金额与卡牌往返、频率和、树不变、全局花色变换、缺失语义 | 映射与边界性质；不是算法正确性 |
| 原生复现 | 固定版本真实建树、step/finalize、查询、存档、锁定 | 引擎 API 生命周期可用 |
| 同源对照 | 同输入原生与适配 EV/频率/指标对比 | 适配保真；不是独立数值依据 |
| 独立数值 | 终局枚举、微型河牌树 LP/BR；转牌小范围完整 runout；翻牌受限小树枚举 | 指定模型的数值正确性和质量，不能推及任意大树 |
| 运行集成 | 真进程取消/崩溃/服务重启/预算、幂等、旧解读取、原子发布、查询竞争 | 长任务和制品可靠性 |
| 产品/MCP | 实际官方客户端、真实数值旅程、双入口、教学资源/导出同权限 | 用户可完成闭环，Agent 没有第二套状态 |

阈值在运行前入 `benchmarks/solver` 的版本化 manifest：caseId、输入 hash、模型、oracle 独立性说明、单位、绝对/相对误差、qualityDefinition、预算、环境及预期支持。R1 起始门槛见 [任务包](solver-real-task-design.md)。无预登记阈值的结果可记实验，不能记验收通过。解非唯一时不要求逐元素策略完全相同。

真实能力发布至少包含对称/不对称范围、零权重/阻断牌、不同 pot/stack、非默认合法尺寸、非 fixture 输入扰动、多个行动路径、损坏输入/制品。转牌/翻牌增加机会概率、花色逆映射和两游标交错访问。nodelock 增加 mask/归一化/新实例生命周期和违反约束检查。

性能报告记录机器、OS/架构、编译器/构建模式、引擎/算法/依赖哈希、线程、压缩、树规模、组合数、质量目标、冷/热状态。分别计建树、分配、求解、质量评估、存档、加载/查询；峰值 RSS 包含哪个进程必须说明。限额声明不等于硬隔离已实现；无法可靠强制内存限制时在能力中说明，并对保守内存估计设启动门槛。

## 5. 自动检查与日常节奏

当前可直接运行的原有检查：

```powershell
npm run typecheck
npm test
npm run test:mcp
npm run e2e
npm run build
git diff --check
```

拟在 R1/R2 实施后增加（当前尚无这些路径与脚本）：

```powershell
cargo fmt --manifest-path engines/postflop/Cargo.toml --all --check
cargo clippy --manifest-path engines/postflop/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo test --manifest-path engines/postflop/Cargo.toml --workspace --locked
cargo build --manifest-path engines/postflop/Cargo.toml --release --locked
npm run lint:solver
npm run test:solver
npm run benchmark:solver:small
```

提交检查跑改动相关的单测、合同和小基准；真实接入/扩街批次完成跑完整既有测试、实际 MCP 和相关浏览器旅程。大树性能基准单独有资源上限，不放在每次保存后的默认测试里。引擎升级、编译/压缩/线程改变或数值偏差出现时重跑受影响基准，不无理由反复跑全套。

后续 CI 先覆盖 Windows x64 的固定环境，小基准不访问远程服务；下载依赖与真正离线运行区分。依赖锁不能替代源码可获得性，换设备记录取得方法和校验值，必要的可复现依赖归档不含私密数据。

## 6. 版本、迁移、评审和交付

新开发分支使用 `codex/solver-real-*`，从当前产品分支可恢复基线开始，不从旧 main 重建。任务按小型可复验提交推进：来源/基准→边界→真实闭环→异常→证据。遵循 [Git 工作流](git-workflow.md)，不移动已有标签，不自动推送或提交大解/临时日志。

每个变更说明触发条件、前后行为、合同变化、验证与限制。评审检查固定输入是否真实传到引擎、单位与索引是否显式、质量是否有独立依据、取消与制品发布是否一致、UI/MCP 是否同状态同权限。无需额外设人为审批点；有授权时通过检查后继续任务。

引擎升级先新增固定版本及差异报告，再复验代表树、质量/资源和旧制品 reader；不得让旧固定引用指向新算结果。schema 升级对旧 Mock 保留来源和缺失字段，迁移不能伪造引擎字段。真实支持矩阵和 R1/R2/R3 状态只按证据更新。

一份可交付报告必须能回答：算了哪个固定问题、用了哪个完整引擎、结果属于哪种模型、数据哪些完整、质量如何定义和验证、资源用了多少、哪些旅程真实跑过、如何恢复/复现，以及还不能做什么。
