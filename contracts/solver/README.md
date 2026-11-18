# R2-A 真实引擎进程边界

2026-11-18：本目录的 `riverline-engine/1` 已实现并实际调用。公开业务协议仍是 `riverline-analysis/1`，现有 46 个工具仍按 Mock 语义工作；没有将内部引擎操作直接注册成产品 MCP 工具。

R2 产品更新：新增独立 `riverline-real-analysis/1` 业务合同与 `business.schema.json`，由 `src/modules/analysis/real-domain.ts` 生成，14 个逐业务工具通过同一 Node 服务与工作区接入。原 46 工具保留原义，MCP 共公布 60 工具；受限河牌 UI/MCP 与恢复的实际证据见 [R2 交付](../../docs/solver/validation/r2-river-delivery-2026-11-18.md)。引擎控制帧没有直接暴露为产品接口。

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

复现从 [R1 基准说明](../../benchmarks/solver/README.md) 开始，先 `npm ci`、`npm run solver:build`，再 `npm run solver:check`、`npm run test:solver` 和独立基准。Rust 固定依赖/工具链与 Python oracle 环境需要网络获取；已有产品仍无需 API Key。
