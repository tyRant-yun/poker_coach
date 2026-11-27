> 历史记录：整理前的设计/交付状态，不作为当前开发指令。当前能力见[最新状态](../../current-status.md)；原始版本可从Git提交 `f416438` 追溯。

# 真实 Solver 代码库方案 v1

日期：2026-11-18。状态：待实施架构决策。配套 [任务包](solver-real-task-design.md)、[工程规范](solver-real-engineering-standard.md)。

执行更新：`engines/postflop`、`runtime/engines/process-runner.ts`、`contracts/solver`、`runtime/analysis` 和真实河牌页面已落地，与原 Node 服务共享工作区。受限模型的实际采用、环境、UI/MCP 和恢复证据见 [R2 交付](solver/validation/r2-river-delivery-2026-11-18.md)。下文更广泛的目录布局仍为计划，不等于全已实现。

## 1. 采用方式

继续使用当前仓库，保留 TypeScript/React 产品与唯一 Node 业务服务。增加 Rust 本地可执行进程，依赖完整 postflop-solver。Node 调度任务、校验制品并提交业务状态；Rust 只处理不可变计算输入、求解与查询，不拥有另一套工作区或教学账本。

| 方案 | 本轮决定 | 原因 |
|---|---|---|
| Rust sidecar＋固定 Git 依赖 | 首选，R1 验证后采用 | 复用现有计算实现，分离 CPU/内存和崩溃边界；保留当前 UI/MCP |
| 受控 fork | 上游确有缺陷或缺少必要接口时 | 保存来源、最小补丁、回归，不另写算法；先用适配解决 |
| Node 原生插件 | 暂不采用 | 增加 ABI/构建和业务进程故障耦合 |
| 浏览器 WASM | 暂不作为主运行时 | 长任务与工作区恢复应独立于页面；避免形成第二份权威状态 |
| 替换为完整桌面产品 | 不采用 | Desktop Postflop 仅借鉴桥接边界，无需重写当前产品 |

主候选固定提交 `9d1509fe5077d019825f833eed04b16d342dfda1`。该版本使用 Rust 2021 edition，许可标识为 AGPL-3.0-or-later；上游声明暂停开发且可能不变版本号就改接口，故不能追随分支或只记录 crate 版本。[固定 Cargo 清单](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/Cargo.toml)、[固定 README](https://github.com/b-inary/postflop-solver/blob/9d1509fe5077d019825f833eed04b16d342dfda1/README.md)。

初始采用默认分配器，关闭 `custom-alloc`；线程与序列化 feature 显式配置、实测。R1 固定实际通过的工具链到 `rust-toolchain.toml`，提交 `Cargo.lock`；旧版预发布序列化依赖的解析兼容性需实际验证。完整依赖失败时先记录并处理可追踪兼容补丁，不能静默升级引擎。首验环境为当前 Windows x64＋MSVC，其他系统没有证据前标未验证。

许可清单记录源码、构建依赖、补丁和采用方式。进程隔离不是许可豁免；分发/提供服务前按实际组合核对义务并提供所需源码与通知。当前不预设可以闭源分发，不为本次设计修改整个仓库许可证。候选失败时再按同样标准验证 TexasSolver 固定 `02c8021ee1307c18aa1e76b772c6ae1451601bc6`，不做自动引擎替换。

## 2. 目录和依赖方向

以下均为计划新增路径，不表示文件已存在。

```text
contracts/solver/                 JSON Schema、协议版本、示例与兼容性说明
src/modules/analysis/            产品类型、界面、客户端；不引入原生引擎类型
runtime/analysis/                从 service.ts 按实际变化逐步抽离
  specifications.ts             输入冻结、预检、模型与能力判定
  jobs.ts                       调度、幂等、attempt、取消与恢复
  solutions.ts                  固定解发布、节点/组合/聚合查询
  experiments.ts                评价目的、锁定变体、比较资格
runtime/engines/
  port.ts                       与引擎无关的计算/查询端口
  mock-adapter.ts                旧 fixture 独立适配，继续明确标记
  postflop-adapter.ts            IPC、映射、校验；不执行扑克算法
  process-runner.ts              子进程、预算、背压、退出处理
engines/postflop/                独立 Cargo workspace，提交 lock
  crates/riverline-solver/
    src/{main,protocol,mapping,solve,query,storage}.rs
  rust-toolchain.toml
  THIRD_PARTY.md                 固定来源、许可、feature、补丁清单
tests/solver/                   TS 合同与集成测试
engines/postflop/.../tests/      Rust 映射、生命周期、协议测试
benchmarks/solver/               小输入、独立 oracle、阈值清单和摘要
docs/solver/validation/          每批真实验证报告
.artifacts/solver/               大型本地输出，忽略提交
```

依赖方向：UI/MCP→应用服务→引擎端口→进程适配器→Rust 外壳→上游引擎。协议 schema 是跨语言合同；公共产品 DTO 和 Rust 引擎结构分别映射，不能由引擎 struct 自动生成整个产品模型。

保留 `runtime/service.ts` 作为现有命令入口，按 R2 实际修改抽离职责，先跑旧行为回归再接真引擎。无必要不重写持久层、旧课程或所有页面。协议黄金样例同时由 TS 和 Rust 验证，防止两套手工类型漂移。

## 3. 业务所有权和合同演进

局面模块拥有玩家、历史、账本和行动树；范围模块拥有输入权重、用户策略和版本；Solver 拥有分析规格、作业、固定解及指标。worker 不直接写日志、发布引用、编辑范围或登记教学暴露。

冻结 `AnalysisSpec` 时绑定：局面/树/范围/策略/约束固定引用、背景人数/活跃人数/求解人数、分析目的、金额/EV/抽水口径、后续价值模型、引擎与算法版本、执行精度及质量目标。分别计算 semanticSpecHash 和执行指纹；缓存使用所需精度/质量筛选，执行证据保存线程/压缩等全部配置。

新增按来源判别的结果 schema：`mock` 与 `engine` 不共用 `demo-target-met` 等质量枚举。独立字段表达 execution、coverage、availability、quality；旧结果保持 Mock 原意，不补造引擎版本或质量。当前公共协议为 `riverline-analysis/1`，实施时做显式能力协商与版本化迁移；改变字段含义必须升主版本，不能悄悄改变 `/1`。

每个指标带定义版本、玩家视角、单位、零点、评价分布及可用状态；缺失返回 null＋reason。输入权重、策略频率、派生范围及真正条件到达概率分开命名。固定双方策略评价、BR 评价、均衡求解、部分锁定各有 `analysisPurpose`，不能复用一个含糊的 solve 开关。

## 4. Node 与 Rust 进程协议

协议拟定 `riverline-engine/1`，与公开 MCP 业务版本分离。每个计算 job 一个子进程；首版全局一个计算槽，资源额度预检后启动。完成解的查询使用有上限的只读进程池，每个实例的可变游标串行访问，每次从根按语义路径定位。查询池和求解共同计入内存预算。

采用有长度限制的单行 JSON 控制消息；大范围输入和完整解走受控目录文件，不塞进 stdout。首版单帧上限 256 KiB，控制范围以外返回制品句柄；父进程逐帧增量解析并限制缓冲。stdout 只发协议，stderr 发有界结构化日志。

握手包含 protocolVersion、binaryHash、engineCommit、algorithmId、features。请求包含 requestId、jobId、attempt、specHash、操作及受控相对制品路径；事件包含同一身份、单调 seq、事件类型和 payload。父进程拒绝版本/身份不匹配、超长帧、重复终态和不合法状态转移。

操作覆盖 inspectCapabilities、validate、solve、cancel、openSolution、query、close。进度是事件，不能把迭代比例当剩余时间保证。取消在 step 间协作检查，立即回复 cancel-requested；只有停止确认才标 cancelled。宽限超时由父进程终止，标 interrupted/forced；Windows 通过受控进程树/Job Object 等经验证机制清理，不能只假设 kill 已释放所有资源。完成与取消竞态由 Node 事务决定，完整解先提交则报告 too-late。

退出后等待流关闭并校验最终结果，再提交状态；部分文件不构成成功。业务服务重启把失联 attempt 标 interrupted，保留诊断并允许用原规格新 attempt 重试。解可读取与训练状态可继续求解是两个能力；未通过续算实验时只支持重新运行。

输入文件只读、任务临时输出位于专属 job 目录；路径解析后必须在根目录内，拒绝绝对路径、越界及链接逃逸。文件数量、总字节和展开尺寸受限。Rust 仅返回相对句柄；Node 校验摘要、结构、绑定关系后复制/发布至现有内容寻址仓。

## 5. 金额、索引和持久化

业务金额延续 1/100 bb 整数账本，动作区分 raise-to 与本次增投。适配器明确引擎整数单位与底池/有效筹码/已投入转换；无法无损表达的尺寸返回预检错误，不四舍五入改树。EV 浮点转换另存单位比例，不经过编辑百分比或账本整数舍入。根底池分母、当前节点收益原点、历史投入、返还和抽水分别保存并用终局例子验证。

产品 comboId 使用规范卡牌对，显式建立 engine 私牌索引和 action-major 映射；牌面冲突组合是 dead，不是零频率。双方位置和花色编码均由映射表转换，不猜数组顺序。引擎浮点原值保留，前端取整只用于显示或显式创建编辑副本。

解制品由 manifest＋原生解＋按需查询索引组成。manifest 保存固定引用、输入/实际树摘要、原生格式版本、引擎构建、所有校验值和质量定义；原生二进制不是公共数据合同。老解需要匹配版本 reader；无 reader 时明确不可读，不用新引擎强读或重新求解覆盖。

提交流程：临时生成→校验完整性与语义→发布不可变 blob→事务提交结果引用。失败产生的孤立 blob 后续安全清理，不先删除旧解。矩阵、combo 和聚合分页查询；继续遵守公共 MCP 的响应上限，外部制品链接也走同一信息权限。

## 6. 花色同构预解库

它是固定真解的精确索引和逆映射层，不是新的 CFR 内核。已有引擎机会节点压缩继续复用，跨用户规格缓存另行验证，不把两层收益相乘宣传。

枚举 24 个全局花色置换，将牌面、死牌、所有范围、策略、锁定、历史中的卡牌和相关模型一起变换，选定稳定序列化最小值并记录逆置换。非对称范围仍可全问题置换，但不能只换公共牌、保留原范围就命中。街道/行动顺序、玩家角色及账本不被置换。

key 包含规范化后的完整语义、树、金额/EV/抽水、后续价值和弃牌相关模型、引擎/算法/规范化版本。浮点使用明确的无损规范表示；禁止随意取整制造同一 key。来源引用随每次查询保留，来源元数据仅在证明与计算无关时排除出 key。native 与 canonical 解各自有制品引用。

命中后反向映射组合、策略、指标和未来发牌菜单，校验质量/覆盖资格。失配返回 miss 并按用户任务排队计算，不借最近牌面冒充结果。同一 key 可存多个质量等级解，选择合格者而非无条件最新者；锁定/价值模型未验证时不缓存该类请求。

测试包含全部置换往返、机会牌重数、范围/锁定破坏对称、死牌和多街路径、输入变化失配、损坏和版本失配。先建少量 HU 河牌可复现样本，再扩大常见规格；测命中率、查询延迟、节省的重复计算、磁盘和预算，不以 1,755 个 flop 公共牌类估计整个求解空间。
