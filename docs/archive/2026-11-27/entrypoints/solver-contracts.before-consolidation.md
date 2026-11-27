> 历史记录：整理前的设计/交付状态，不作为当前开发指令。当前能力见[最新状态](../../../current-status.md)；原始版本可从Git提交 `f416438` 追溯。

# R2-A 真实引擎进程边界

2026-11-27 AF 更新：新增 `flop.schema.json` / schema5、`native-flop-paged/5`，在同一案例/规格/作业/制品/浏览服务中提供真实受限HU翻牌三街研究，每方≤16正组合、每街每方≤1固定下注、无再加注。为兼容旧存档沿用案例的 `.turn` 容器，以 `kind: hu-flop/5` 与 `flopBets/turnBets/riverBets` 显式区分；`real_turn_solution_query` 沿用类型化action/deal路径，schema5可连续访问两次机会节点。旧schema1–4不改义，不输出整树；原生读取使用64KiB缓冲，hash/身份校验保持。现有同一MCP服务共86工具（含四个策略工具）。[实际数值/容量/限制](../riverline-auto-feedback-delivery-2026-11-27.md)。自动整手翻牌和可信100BB翻前数据未交付。

2026-11-26 更新：新增`turn.ts`/schema3、`turn/turn-node/turn-path.schema.json`。`real_turn_solution_query`使用`action(index)`/`deal(card)`类型化路径，返回decision/chance/terminal节点与物理牌面、兼容权重、概率及指标。真实worker、预检、作业发布、取消/中断/固定规格重试与恢复沿用同一服务；MCP共75工具（14整手、15真实研究）。产品转牌每方≤16正组合、每街每方≤1固定尺寸、无再加注；`query-turn`是内部原生reader命令，≤16KiB请求/128KiB结果/5秒，读取槽与河牌共享2个，各模型LRU8。旧schema1/2和数字路径不改义。实际独立验证、信息边界与资源见[第二轮交付](../riverline-round2-delivery-2026-11-26.md)。

2026-11-25 更新：一般河牌树已接入产品合同/worker/UI/MCP与原生按需查询、派生范围及恢复，实际证据见 [第一轮交付](../riverline-first-round-delivery-2026-11-25.md)。MCP现为73工具（含13个整手工具）；下文六节点投影仅指原受限模型，不得用于一般树。最新 [N06–N08计划](../riverline-round2-task-design-2026-11-25.md) 将在独立验证后扩展转牌机会节点/类型化路径，当前未实施，旧存档合同不改义。

一般河牌前置更新（2026-11-18）：新增 `river-tree.ts` 的显式树 schema 2 与原生分页请求/响应 schema，支持内部 `validate-river-tree`/`query-river-tree` 研究命令；六个独立质量问题通过，未改变原 worker、业务 `real-analysis/1` 或产品能力。语义、预算与下一步见 [一般河牌验证](../solver/validation/r2-river-tree-2026-11-18.md)。生成 schema 由同一 `npm run solver:contract` 更新并测试。

2026-11-18：本目录的 `riverline-engine/1` 已实现并实际调用。公开业务协议仍是 `riverline-analysis/1`，现有 46 个工具仍按 Mock 语义工作；没有将内部引擎操作直接注册成产品 MCP 工具。

R2 产品更新：新增独立 `riverline-real-analysis/1` 业务合同与 `business.schema.json`，由 `src/modules/analysis/real-domain.ts` 生成，14 个逐业务工具通过同一 Node 服务与工作区接入。原 46 工具保留原义，MCP 共公布 60 工具；受限河牌 UI/MCP 与恢复的实际证据见 [R2 交付](../solver/validation/r2-river-delivery-2026-11-18.md)。引擎控制帧没有直接暴露为产品接口。

`engine.ts` 为 TS schema/type 来源，`command/event/river.schema.json` 为版本化制品，`npm run solver:contract` 更新并由测试核对。Rust 使用严格 serde 结构读控制帧，与 TS 共用 `examples/solve.json` 黄金输入；扑克语义以 Rust 预检为权威，TS 不重写牌规。

每个计算 attempt 使用独立的新目录，只含父进程写入的 `input.json`。`runtime/engines/process-runner.ts` 计算字节 SHA-256 与二进制指纹，启动 Rust `worker DIRECTORY`；worker 校验同一输入哈希，拒绝输入软链接及已有输出。固定文件名不接受客户端提供任意读写路径。

流程：hello（版本/引擎/算法/features/不支持续算）→父进程 solve（固定 request/job/attempt/specHash）→started→有界 progress→completed/cancelled/failed。所有控制帧≤256 KiB、事件序号单调，stdout 只发 JSON；stderr 保留有界诊断。完整树不在进度或摘要内传送，研究驱动的整树导出不用于此运行器。

成功产生暂存的 `solution.bin`、`summary.json` 和当前模型的六个独立节点投影文件；摘要包含节点路径/哈希索引，不包含整个节点数据。Node 运行器等待 close 后核对终态、身份、文件类型/大小并计算摘要，返回文件描述。**运行器返回不是业务解发布**；`runtime/analysis/real-service.ts` 在校验固定来源、节点维度和权限后，以一次工作区提交发布不可变真实解。六节点投影仅适用本模型，将来通用大树必须增加原生按需读取器。

取消通过同一身份的 cancel 消息在真实 step 间检查；取消先于 hello 时排队发送。父进程等待 cancelled 事件与进程关闭后才确认。2 秒无确认则终止，返回 interrupted；直接强制中断同样不称 cancelled。完成已暂存时可返回 completed，由应用事务判定 too-late，不覆盖固定解。业务层已实现单计算槽、进度、取消迟到、实际服务器终止恢复及固定规格新 attempt；生产硬内存隔离与 checkpoint 续算尚未实现。

实测包括真实完成与原生制品、立即取消及无成功制品、强制中断、非法牌面、输入 schema、排斥复用旧 attempt 目录；黄金协议另有 Rust 解析与超长/缺行尾/未知字段拒绝。`npm run test:solver` 运行实际进程测试，不是 Mock。原生文件 magic 由 bincode varint 编码，原始头部有 `0xfc` 标志；不能把源码注释中的逻辑 magic 四字节直接当整个文件头。

## 下一步

1. 增加一般河牌下注树的独立尺寸/终局/锁定基准，再扩展合同和原生按需读取器。
2. 依次推进 R2-D 转牌、E 翻牌，各自独立验证机会概率、条件范围和资源。
3. R2-F 真实实验、G 教学消费、I 同构预解库及 R3 仍独立验收，受限河牌闭环不替代这些能力。

复现从 [R1 基准说明](solver-benchmarks.before-consolidation.md) 开始，先 `npm ci`、`npm run solver:build`，再 `npm run solver:check`、`npm run test:solver` 和独立基准。Rust 固定依赖/工具链与 Python oracle 环境需要网络获取；已有产品仍无需 API Key。
