# R2-A 真实引擎进程边界

2026-11-18：本目录的 `riverline-engine/1` 已实现并实际调用。公开业务协议仍是 `riverline-analysis/1`，现有 46 个工具仍按 Mock 语义工作；没有将内部引擎操作直接注册成产品 MCP 工具。

`engine.ts` 为 TS schema/type 来源，`command/event/river.schema.json` 为版本化制品，`npm run solver:contract` 更新并由测试核对。Rust 使用严格 serde 结构读控制帧，与 TS 共用 `examples/solve.json` 黄金输入；扑克语义以 Rust 预检为权威，TS 不重写牌规。

每个计算 attempt 使用独立的新目录，只含父进程写入的 `input.json`。`runtime/engines/process-runner.ts` 计算字节 SHA-256 与二进制指纹，启动 Rust `worker DIRECTORY`；worker 校验同一输入哈希，拒绝输入软链接及已有输出。固定文件名不接受客户端提供任意读写路径。

流程：hello（版本/引擎/算法/features/不支持续算）→父进程 solve（固定 request/job/attempt/specHash）→started→有界 progress→completed/cancelled/failed。所有控制帧≤256 KiB、事件序号单调，stdout 只发 JSON；stderr 保留有界诊断。完整树不在进度或摘要内传送，研究驱动的整树导出不用于此运行器。

成功只产生暂存的 `solution.bin` 与 `summary.json`。Node 等待 close 后核对终态、身份、文件类型/大小并计算摘要，返回文件句柄。**这不是业务解发布**；工作区事务、不可变 SolutionManifest、按需查询索引、版本权限仍需 R2-A/B 实施。摘要中的数值源于真实引擎，不是 fixture。

取消通过同一身份的 cancel 消息在真实 step 间检查；取消先于 hello 时排队发送。父进程等待 cancelled 事件与进程关闭后才确认。2 秒无确认则终止，返回 interrupted；直接强制中断同样不称 cancelled。完成已暂存时可返回 completed，后续由应用事务定义 too-late，不覆盖固定解。当前子进程不启动外部子进程；生产资源调度/硬内存隔离和业务重启恢复仍待 R2-C。

实测包括真实完成与原生制品、立即取消及无成功制品、强制中断、非法牌面、输入 schema、排斥复用旧 attempt 目录；黄金协议另有 Rust 解析与超长/缺行尾/未知字段拒绝。`npm run test:solver` 运行实际进程测试，不是 Mock。原生文件 magic 由 bincode varint 编码，原始头部有 `0xfc` 标志；不能把源码注释中的逻辑 magic 四字节直接当整个文件头。

## 下一步

1. R2-A 剩余：在唯一本地应用服务中定义真实规格/作业/结果判别类型、能力与逐业务工具 schema；明确旧 Mock 数据迁移和独立教学信息边界。不要让这个进程运行器另建工作区或直接登记业务状态。
2. R2-B：先接受本批已验证的受限河牌模型，固定范围/树/账本；UI 和实际 MCP 客户端完成同一任务与版本查询；原生解通过按需读取提供组合/聚合，数值保留浮点及缺失状态。
3. R2-C：单计算槽与资源预算、取消确认/迟到、服务中断/新 attempt 重试、原子发布与损坏恢复；再跑真实旅程。不能把本轮进程测试记为整个 R2-C 已完成。
4. 增加独立基准后扩大一般河牌树与转牌、翻牌；R3 和同构预解库保持独立状态。

复现从 [R1 基准说明](../../benchmarks/solver/README.md) 开始，先 `npm ci`、`npm run solver:build`，再 `npm run solver:check`、`npm run test:solver` 和独立基准。Rust 固定依赖/工具链与 Python oracle 环境需要网络获取；已有产品仍无需 API Key。
