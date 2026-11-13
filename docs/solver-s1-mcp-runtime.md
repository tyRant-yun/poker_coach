# S1 MCP 与本地业务运行时合同 v0.3

实施更新（2026-11-13）：SO01–SO09 的 S1 本地 Mock 实现已进入应用，实际范围、验证、已知限制与证据以 [S1 交付记录](solver-s1-delivery.md) 为准。本文 v0.1–v0.3 中“未实施/未测试”描述保留当时设计状态；不覆盖本次实际记录。R1–R3 仍未执行。

日期：2026-11-12。状态：设计，未实现。对应 [约束映射](solver-s1-constraint-mapping.md)、[原任务修订](solver-s1-task-design.md)、[共享领域合同](solver-s1-contracts.md)。这是 S1 的必需交付，计算继续 Mock 不降低协议/状态/保存的真实性。

## 1. 唯一业务运行时

v0.3 采用一个本地 Node 业务进程，管理一个已绑定 workspaceId 的权威状态、版本、命令、任务、暴露账本和制品仓。它不是云后台，不接真实扑克计算。现有 React/Vite 页面保持产品外壳；Zustand 只作查询投影/编辑暂存，不再是新工作区业务权威。

```text
浏览器 UI ──本地 HTTP 命令/查询──┐
                               ├─ 唯一应用服务/信息策略 ─ 权威存储 + 独立制品仓
实际 MCP Client ─ stdio MCP代理 ┘             │
                                      独立 Mock worker
                                       （未来引擎适配）
```

- MCP 使用正式 stdio server（薄代理）连接同一本地业务进程。代理不得另建 store、fixture 结果或独立作业队列；浏览器不需要打开，工具仍可工作。先只交付 stdio，不为本轮扩大到远程 MCP 部署。
- 启动器先保证单一本地服务/工作区，再启动浏览器开发资源；MCP 代理附着已绑定 runtime。未启动时返回 RUNTIME_UNAVAILABLE 与启动说明，不静默初始化另一工作区。
- 同一 workspace 只能有一个写进程；启动时检查锁/实例身份，多个 MCP client 与浏览器会话可同时连接该实例。不同 workspaceId 必须显式切换，不能按“当前最活跃页面”推测。
- 浏览器 HTTP 仅本机监听，检查允许的 Origin，并使用本地会话握手标识；握手不是业务角色授权。stdio 日志只走 stderr，不污染协议 stdout。不要求第三方 API Key。
- 统一服务执行语义校验、expectedRevision、幂等、信息规则和提交；UI/MCP transport 只转换 DTO。长期运行不依赖 React effect、浏览器定时器或 MCP 请求保持连接。
- 页面持有未提交编辑时保存为有版本的草稿；失联可保留暂存但不能显示已保存/已分析。重连先读 revision 再处理冲突；不得离线维护第二个可写权威工作区。

共享新工作区包含迁移后的必要旧案例、T1 课程/首次作答/暴露及知识引用状态。可以分 repository/模块，但所有活动状态通过同一服务访问。旧浏览器 IndexedDB 作为迁移来源保留；迁移完成后在新运行模式中不再双写旧库。原纯浏览器模式仅用于明确的旧版回看，不能同时参与新工作区写入。

## 2. 存储与事务边界

设计目录 `.data/riverline-s1/<workspaceId>/`（已被现有 `.gitignore` 排除），内容由用户本机保存。单写入者使用版本化快照＋带事务边界/校验的追加日志持久化命令及幂等结果，完整解存独立内容寻址文件/块；不把全树塞进工作区 JSON。具体 repository 可替换，但下列行为必须实现：

1. 成功响应前完成持久提交；变更和 requestId→结果索引在同一提交中落盘。崩溃恢复验证已提交事务，截断尾部不能悄悄丢弃已确认提交；发现损坏保留原件并进入明确恢复状态。
2. 制品先写暂存并校验，再提交可见 manifest 引用；崩溃留下的孤立块不可见。读取丢块/哈希不匹配返回 ARTIFACT_INCOMPLETE，不返回半份可用解。
3. 模块索引只保存 refs/摘要/状态；SolutionArtifact 的内容另存，索引含字节数、格式版本、块/节点索引及 hash。选择矩阵不重复序列化制品。
4. 旧库迁移在浏览器读取后通过统一 import 命令上传：预检、原始快照封存、稳定来源去重、导入事务、显式激活。旧库未改；响应丢失重试不重复迁移。
5. 当前教学记录和暴露在同一权威事务中提交；含答案投影先持久登记再发响应。迁移暴露连续性不明则 unknown/possible，不假定未见。S1 不再采用“浏览器暴露库＋本地 MCP 暴露库”双账本。
6. 备份以 manifest＋依赖制品形成可校验归档；导入缺依赖先隔离，不激活，保留当前工作区。备份包含答案时先登记 possible-exposure；下载全解不得用无检查静态文件路径绕过策略。

故障/断电恢复是实际验收项，不能只靠内存 repository 的单元测试。浏览器旧库备份/迁移与本地新格式独立标识版本，不给旧记录补造引擎字段。

## 3. 冻结调用合同

本产品 `contractVersion=riverline-analysis/1`，领域 JSON schema、工具输入输出与错误 schema 在 SO01 建单一共享包；UI HTTP、MCP server 和 SDK client 测试共同引用。协议版本由 SDK initialize 协商，不能把产品合同版本当 MCP 版本。

所有工具参数绑定 workspaceId；执行身份/教学会话由服务端连接上下文和持久状态检查，不接受客户端自报 `coach=true` 绕过答案。写命令有 requestId、expectedRevision、目标固定 ref；新建命令的 expectedRevision 指容器/工作区版本，已有对象修改指目标版本。

成功 envelope：contractVersion、workspaceId、requestId、operationId（如有）、revision、artifactRefs、availability、data（受控投影）、warnings、nextCursor（如有）。固定 ref 至少 id/version/contentHash/kind；返回“成功”必须有已持久对象、版本或明确作业状态。

失败 envelope：code、message、fieldErrors、retryable、currentRevision、relatedRefs。至少包括 VALIDATION_ERROR、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、NOT_FOUND、INFORMATION_RESTRICTED、RUNTIME_UNAVAILABLE、RESOURCE_LIMIT、ARTIFACT_INCOMPLETE、UNSUPPORTED_CONTRACT、TOO_LATE。协议/参数错误遵循 MCP 标准；业务执行失败由 tool result `isError=true` 和结构化数据表达。

无覆盖、不支持的分析结果属于正常 availability，不冒充协议错误；结构/能力预检拒绝的写操作不改变原输入。失败不回传被限制内容。工具注解仅是描述，真实约束仍在服务中。

- 幂等键为 workspaceId＋业务操作＋requestId。相同键/相同规范化负载重放原结果；不同负载返回 IDEMPOTENCY_CONFLICT。会话重连不清空索引，已完成作业不重跑。
- 并发编辑只允许一个 expectedRevision 成功；另一个冲突保留原 patch，不静默合并或覆盖；用户可创建分支继续。
- 批量范围/策略 patch 作为一次完整业务动作，最多覆盖 1,326 组合，先全量校验再全量提交；任一非法项不部分应用。请求体上限 1MiB，超出明确拒绝。
- 普通查询默认 100、最多 200 项且序列化正文不超过 128KiB；先到任一上限即截页。全范围写可以批量，读可以矩阵摘要或分页组合，不需要 1,326 次工具调用。
- cursor 绑定输入版本、筛选、排序与信息策略版本。下一页版本或权限改变则失效/重新检查，不能借旧 cursor 读隐藏内容。事件流按 sequence 获取改变的 refs；发生缺口返回重新同步指示。

## 4. MCP 核心工具表

名称是冻结目标；可以附加工具，但不能只开放一个任意写 store 的通用执行工具代替。各工具对应同名职责的应用服务，不读取 transport 专属 fixture。

| 工具 | 完整业务动作/结果 | 任务 |
|---|---|---|
| workspace_get / workspace_changes | 绑定工作区摘要/版本及按序变更 refs | SO01/08 |
| situation_create / situation_revise | 保存玩家/事实/历史/树的局面修订；新版本不覆盖旧解 | SO01/04 |
| solver_capabilities | 五类能力、操作、模型、覆盖与当前完成状态 | SO01 |
| analysis_spec_create / analysis_preflight | 固定分析规格/预检，保留无覆盖输入 | SO01 |
| range_get / range_edit_batch | 读取范围/来源/分页组合；批量编辑产生草稿/新假设 | SO02 |
| range_derive | 固定范围＋策略＋行动派生范围，返回模型和来源 | SO04 |
| policy_edit_batch / policy_submit | 批量混频草稿与固定提交、辅助身份 | SO02 |
| solution_load | 按 ref 或精确固定规格加载解，返回 manifest 摘要 | SO01/06 |
| analysis_start / analysis_get | 排队作业并立即返回 jobRef；读取阶段/事件/结果 ref | SO01/08 |
| analysis_cancel / analysis_retry | 取消请求/确认状态、显式按旧规格重试 | SO01/08 |
| solution_node_strategy | 指定固定解、节点与玩家的策略投影/分页 | SO06 |
| solution_combo_metrics | 批量组合的按项指标可用性、单位、口径 | SO06 |
| solution_range_aggregate | 固定分母、筛选和指标聚合，缺失不补零 | SO06 |
| analysis_handoff | 从固定六人/HU路径携带范围/账本/模型建立翻后规格 | SO05/06 |
| policy_evaluate | 固定用户策略请求评价制品；长任务返回 jobRef | SO07 |
| experiment_create / experiment_compare / experiment_conclude | 固定基准、锁定变体、比较资格、观察与有条件结论 | SO07 |
| teaching_attempt_submit / teaching_feedback / teaching_next | 固定允许的作答、引用分析/理论的反馈、相关条件变化的新题 | SO09 |
| workspace_export / workspace_import | 受控归档任务/预检与幂等导入，含答案暴露登记 | SO08/09 |

策略修改、评价、锁定分析分开；experiment_create 可以原子建立分支/规格/约束，但不能隐式修改基准策略。其他声明的核心 UI 操作（如草稿撤销/重做、范围/策略分支、结论修订）也应有同服务 MCP 业务工具，在 SO02/07 的 manifest 一并列全，不能留作仅页面内写 store 的后门。

## 5. MCP 资源和信息策略

只提供服务内受控 URI，例如 `riverline://<workspaceId>/solutions/<id>/<version>/manifest` 与节点页；资源读取和工具查询调用同一个投影服务。资源列举只显示当前允许的摘要，不直接泄漏答案是否存在。

每次 `resources/read` 重新检查工作区、当前独立题、暴露语义键、制品身份及缺依赖；此前允许得到的 URI 不保证后来仍可读。需要主动揭示时先通过同一服务登记，不能仅凭资源访问自动批准。制品存储路径/临时文件地址不得作为可绕过策略的下载链接；全量备份经受控导出。

反馈引用内容受同一允许信息规则约束，失败响应/日志/工具摘要/通知也不得包含答案或未来牌。Solver 只提供证据，评价解释资格与错因仍归评价模块，下一题归教学编排；合成数值不获得真实 GTO 判断资格。

## 6. 长任务与大结果

Mock worker 与界面、MCP 连接生命周期分离。analysis_start 只做持久化排队和返回引用；计算进度经 analysis_get/事件查询，MCP 可选 progress 通知不能是唯一查询路径。S1 不依赖实验性 MCP 长任务扩展。

- cancel_requested 是可见中间态；只有运行器确认停止/已隔离迟到产物后才 cancelled。确认后不发布结果；若 completed 先提交，取消返回 TOO_LATE 和原固定结果。worker 迟到到达已取消作业只能丢弃/隔离，不能改成功。
- 浏览器刷新或关闭不打断本地作业，重新连接继续查同一 job。仅运行时/worker 真正中断才 interrupted；启动扫描租约/未完成任务后标明，用户显式恢复/重试。
- S1 不宣称支持计算中间态续算；恢复优先找已提交成果，否则新 attempt 从原 spec 重跑；R 阶段只有通过 checkpoint 验证才开放 resume。
- 限制并发、内存/制品字节、队列长度与时间预算进入配置并可查询。资源不足保留规格，返回 RESOURCE_LIMIT，不删尺寸/换范围。
- 大结果以 manifest＋索引/块保存；按需查询只读取相关节点/组合。工具/上下文返回摘要与 refs；受控分页资源也遵守 128KiB 上限，不循环把全树拼进 Agent 上下文。

## 7. 真实 MCP 客户端验收

使用官方 TypeScript SDK 的真实 Client 和 stdio transport 启动 MCP 代理，执行 initialize、tools/list、tools/call、resources/list/read；SDK 及其依赖在开发时选兼容版本并固定锁文件。本设计阶段不安装依赖，不把本聊天工具、直接调用应用函数或手写伪响应当验收。

测试进程包括本地服务、stdio server/client 和 Playwright 浏览器，绑定同一个临时持久 workspace：

1. UI 创建/提交→MCP 读 ref/version，MCP 批量修改→UI 获取同一新 revision；反向创建与接手也实际操作。
2. 浏览器关闭仍能用 MCP 创建/查询/取消作业，再打开看到相同持久成果；服务停止时两入口一致不可写。
3. 相同 requestId 重发、跨入口版本冲突、取消迟到、服务崩溃/重启/重复调用均有明确状态且不重复成果。
4. 独立题限制覆盖 tools 与 resources；已取得 URI 不能在上下文变化后绕过；主动揭示先登记再返回，两入口同见辅助身份。
5. 至少 16MiB 的**结构/存储测试专用**确定性分块资产验证分页、字节上限、丢块/损坏及恢复，不把填充数据当新的扑克解；记录实际响应字节与内存，不用过高性能目标伪称优化完成。
6. 保存脱敏的协议过程、工具清单/schema、制品 refs、UI 截图、错误断言和恢复后状态。所有公开核心工具至少经实际客户端调用一次，并覆盖关键失败路径。

对应 SJ16–SJ21，并与旧 SJ01–SJ15 共同验收。最终能力表逐项列“设计/实现/协议实测/业务旅程通过”，不能用一个 MCP ping 代表全部工具可用。

## 8. 官方协议依据

2026-11-12 本次阅读：[Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)、[Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。采用标准 tools/resources 与 stdio；业务不变量、持久化、教学资格和分页预算由本产品合同定义，不能误认为 MCP 自动提供。

## 2026-11-13 实施补充

公开业务工具当前为 46 个，真实清单/schema 来自 `src/modules/analysis/domain.ts`，服务在 `runtime/service.ts`，MCP 仅代理到 `runtime/server.ts` 的同一服务。额外提供 `situation_fork`（从固定旧版本建独立假设）、`artifact_inspect`（固定元数据/策略聚合与组合页）、`review_extract`（从封存旧手牌提取行动前事实）和 `teaching_record_exposure`（登记旧版可能暴露）。启动与客户端配置见交付记录。

版本号输入可使用 `id@version`，包括尚未归档的最新版本；实际版本/哈希不符时拒绝。UI 暂存首次编辑时的目标引用；提交时另校验目标版本，不能在读取最新工作区 revision 后静默覆盖对象。冲突可以保留输入、放弃，或从原版本创建分支。所有写操作仍须 requestId/expectedRevision。

S1 独立题默认拒绝全部未列入允许清单的工具，避免新增写工具成为答案/未来信息入口。旧页面每次进入和定期检查权威服务，不能凭标签页存储决定是否检查。S1 暴露后的旧版未来作答采用保守辅助投影，不改原首次记录。原版旧业务没有在本轮全部迁成 MCP 工具；新 S1 没有浏览器第二工作区。

工作区摘要最近 10 个作品（上限 20、可分页）、最近 10 个任务/解/实验及当前作品最近 20 个策略；全量解不进摘要。请求 1MiB、响应硬预算 120,000 字节（公开上限 128KiB）、组合页最多 200 项，制品块 64KiB，分块导入最多 64MiB。备份容器不再次嵌入此前生成的备份。超预算/不支持返回明确错误，不删树或替换输入。
