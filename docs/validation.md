# 验证与证据

最后功能/拆仓实测日期：2026-11-27。本轮仅重整文档与固定文档引用，没有新增功能，不将历史通过数字写成本轮重新测试。

| 范围 | 实际结果 | 来源 |
| --- | --- | --- |
| 产品AF基线 | 105状态、20规则/报告/Bot、17 TS/CLI Solver、14 Rust、6真实MCP（86工具）、61浏览器 | `7e0f9af`；[AF交付](archive/2026-11-27/riverline-auto-feedback-delivery-2026-11-27.md) |
| 三仓库接入 | 产品构建/类型、20规则/报告/Bot；新仓安装/旧ZIP/损坏拒绝 | `f416438`；[拆仓记录](archive/2026-11-27/riverline-repository-organization-2026-11-27.md) |
| Bot独立基线 | 381 passed、2 skipped，固定核心验证 | `276cfe9`；Bot仓库历史验收 |
| Solver独立基线 | 构建、14 Rust、12 schema，10河牌/6转牌/4翻牌数值门 | `6569a01`；Solver仓库历史验收 |

两项Bot跳过分别缺可选v1.2.3对照/v1.0工件，不宣称通过。工程测试不证明整体强度；小范围数值门不证明宽范围、多人或通用全局均衡。

## 常用检查

产品：`npm run typecheck`、`npm run build`、`npm test`、`npm run test:game`、`npm run test:solver`、`npm run test:mcp`。浏览器：`npm run e2e:first-round`；整版设置 `RIVERLINE_ALL_JOURNEYS=1` 后执行同一命令。隔离测试目录与默认用户数据分开。

组件：`npm run components:check`；独立数值门见[基准入口](../benchmarks/solver/README.md)。证据JSON仍在 `solver/validation/`，例如[翻牌](solver/validation/af-flop-evidence-2026-11-27.json)、[容量](solver/validation/af-flop-capacity-2026-11-27.json)、[缓存](solver/validation/af-cache-evidence-2026-11-27.json)。

文档整理检查记录在[归档索引](archive/README.md)：链接、清单/原始来源、npm命令存在、组件一致性和Git差异。纯文档未重复运行应用、平台或模型测试。
