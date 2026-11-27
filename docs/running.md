# 运行与使用

## 环境与首次安装

本机验证环境为Node24、Python3.14.3；真实Solver固定Rust1.85.1、单线程。Windows需要MSVC x64 C++工具和Windows SDK，脚本在固定引擎目录加载构建环境。无需LLM API Key。

在产品根目录执行：

```powershell
npm ci
npm run rules:setup
npm run solver:build
npm run build
npm start
```

打开[练习](http://127.0.0.1:5174/play)。页面和API由同一本机Node服务提供；不要直接双击HTML。已运行旧服务时先结束原终端中的服务，重新构建/启动后刷新。

## 可选HU Bot与组件版本

将 `riverline-bot` 克隆到产品旁边，按 `components.lock.json` 的Bot提交检出，再执行：

```powershell
npm run bot:setup -- ../riverline-bot
npm run components:check
```

安装器只接受固定五文件核心指纹，也会检测相邻Bot仓库；旧冻结ZIP路径仍兼容。升级按[组件流程](git-workflow.md)处理。产品已包含Solver快照，可直接构建。

## 主流程

1. **练习 `/play`**：选择桌型/位置/对手/节奏，开始一手；需要时标记疑问。对手行动按公共表现帧播放，可跳过。
2. **结束报告**：自动展示结算、已评价/待算/未知决定和EV图；顶部“下一手”继续练习，“查看本手牌桌”展开结果牌桌。
3. **复盘 `/hands`**：筛选手牌并选择原决定，先看价格、覆盖、行动EV/频率与建议，再查看行动前牌桌。未覆盖不表示零损失。
4. **研究 `/solver/real`**：从已覆盖决定进入同一固定解，点行动/合法转牌或河牌查看后续；也可加载“翻牌三街研究”等预设再“开始分析”。先看Hero图，再展开矩阵与输入。
5. **返回原手**：链接保留hand与decision；改变范围/模型需重算，旧解继续标原输入。

翻前/翻牌未获自动评价时仍保留问题和事实，手工预设不等于原手已评分。翻前数据导入是报告内高级入口，普通练习无需先填写策略表。

旧 `/solver` 是合成示例工作台，`/learn`为历史教学模块，与真实研究的[能力边界](current-status.md)区分。

## 开发、数据与备份

`npm run dev`使用Vite5173＋Node5174；日常体验推荐构建后同端口模式。常用检查见[验证](validation.md)。

默认业务目录为 `.data/riverline-s1/local`，可用 `RIVERLINE_DATA`、`RIVERLINE_WORKSPACE`、`RIVERLINE_PORT` 选择隔离目录/工作区/端口。手牌与自动报告在 `hands.sqlite`，策略在 `strategies.sqlite`，研究使用业务journal与原生制品仓；旧教学/示例数据还使用浏览器IndexedDB。

Git备份不包含运行数据。策略库尚未纳入整手/研究导出，原始规范包与核验记录需另存；数据迁移须另行备份/干跑。本轮文档清理不重置工作区。
