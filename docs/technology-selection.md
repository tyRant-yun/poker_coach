# 第一版 Demo 技术栈与架构决策

日期：2026-11-12（Asia/Shanghai）。状态：技术方案已确认；用户已授权第一轮 D01，应用依赖已安装并锁定。实际实现和版本见 `d01-delivery.md` 与 package-lock.json。

## 1. 已确认方案

模块化前端 + 应用命令层 + 纯 TypeScript 领域逻辑 + 端口式 Mock 适配器；应用在浏览器内运行，当前无业务服务端。

| 层面 | 选择 | 责任 |
|---|---|---|
| 语言 | TypeScript strict | 明确局面、策略、版本、任务与结果合同 |
| 应用 | React + Vite SPA | 交互工作台与客户端构建 |
| 路由 | React Router | 可定位的案例、训练会话和报告入口 |
| 共享状态 | Zustand | 规范化工作区状态、选择器订阅 |
| 瞬时交互 | React 局部状态 | hover、临时输入、弹窗和焦点 |
| 主存储 | IndexedDB + idb | 案例、策略版本、报告与作答的异步保存 |
| 小型偏好 | localStorage | 主题、布局、最近案例、演示速度 |
| 边界校验 | Zod | 导入、快照、fixture 和适配器结果的运行时校验 |
| 样式 | CSS Modules + CSS 变量 | 工作台布局和统一视觉设计变量 |
| 图形 | DOM + SVG | 范围矩阵、节点路径与比较图 |
| 模拟 | 类型化端口、确定性脚本、可替换时钟 | 外部能力、生命周期、取消与故障 |
| 验证 | Vitest + Playwright | 关键机制与真实用户旅程 |
| 工程 | npm、package-lock.json、Git | 依赖固定、检查点与恢复 |

## 2. 选择依据与取舍

- React/Vite：当前核心是客户端复杂编辑与多面板联动，不需要引入服务端渲染流程。路由、状态、保存需要显式组织；领域逻辑不能散落于组件 effect。
- Zustand：案例、策略、任务、报告跨模块共享，选择器便于减少无关订阅；组件必须经应用命令修改业务状态。局部交互不进入全局 store。
- IndexedDB/idb：多案例、多策略快照和作答适合结构化、异步保存；小型偏好才使用 localStorage。引入 schema 和恢复机制，不把浏览器存储视为可靠云备份。
- Zod：TypeScript 不能替代运行时数据检查。结构校验之外，版本匹配、概率和信息视角仍由领域约束决定。
- DOM/SVG：先保证组合编辑、键盘操作和测试定位；大型图引擎或 Canvas 仅在测量证明需要时评估。
- Vitest/Playwright：测试不可变版本、取消、投影、恢复等机制，并验证完整旅程；不测试合成结果是否为真实 GTO。

Context/reducer 可以实现同类应用，但共享订阅需要更多手工组织；Redux Toolkit 也可行，当前采用较小的状态方案。真实后端、Solver、规则引擎、模型及知识检索技术继续独立评估。

## 3. 实施约束

1. UI 与 Agent 调用同一应用命令；不直接写持久化层或读取 fixture 制造结果。
2. 领域逻辑不依赖 React、Zustand、IndexedDB 或视图组件。
3. Zustand 是运行时状态容器；提交版本和制品经存储端口保存，不把整个 store 无差别自动序列化。
4. fixture 随应用发布且不可修改；用户覆盖层与其分开保存。
5. 首批使用异步端口 Mock，当前不需要 HTTP Mock 服务或真实任务队列。
6. D01 包版本已写入单一锁文件，兼容性验证结果见交付记录；后续升级仍需按影响验证。
7. 浏览器内的信息投影只演示访问规则；真实权限和考试答案保密需要未来服务端设计。

## 4. 已查阅的官方资料

- [React 客户端应用路径](https://react.dev/learn/build-a-react-app-from-scratch)
- [Vite 指南](https://vite.dev/guide/)
- [React Router 声明式路由](https://reactrouter.com/start/declarative/installation)
- [Zustand 官方仓库](https://github.com/pmndrs/zustand)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) 与 [Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- [idb 官方仓库](https://github.com/jakearchibald/idb)
- [Zod 文档](https://zod.dev/)
- [Vitest 指南](https://vitest.dev/guide/)
- [Playwright 文档](https://playwright.dev/docs/intro)

资料用于前轮架构分析。D01 已按该技术方向开发；依赖兼容性以实际构建和测试结果记录，不以文档中的最新版本号替代验证。
