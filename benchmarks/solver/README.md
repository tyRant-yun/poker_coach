# Solver独立数值基准

数值资产在[独立Solver](https://github.com/tyRant-yun/riverline-solver)开发，产品固定其快照。已有10河牌、6转牌和4翻牌问题，最近实测见[验证记录](../../docs/validation.md)。

| 命令 | 范围 |
| --- | --- |
| `npm run benchmark:solver:small` | 4受限河牌；枚举、LP/BR、终局/行动EV |
| `npm run benchmark:solver:tree` | 6一般河牌；多尺寸/加注/锁定及节点指标 |
| `npm run benchmark:solver:turn` | 6转牌；不预知未来牌的LP/BR、条件发牌与现金流 |
| `npm run benchmark:solver:flop` | 4翻牌；枚举、LP/BR、固定私牌三街反向递推 |

先构建，再准备独立oracle环境：

```powershell
npm run solver:build
py -m venv .artifacts/solver/oracle-venv
.artifacts/solver/oracle-venv/Scripts/python.exe -m pip install -r benchmarks/solver/requirements.txt
```

原始输出与采样写入隔离 `.artifacts/solver` 或 `.artifacts/af`。oracle不把引擎评估器/BR当作自身真值。按冻结manifest检查门槛；运行结束、引擎目标和独立数值通过分别记录。短进程峰值未被采样时记null。

容量采样保留超预算失败；1176组合简化树不等于全范围三街通过。短筹码公开数据核验见[数据边界](../../docs/data-sources.md)，不能证明100BB评分。

固定Rust1.85.1、上游commit、单线程和依赖锁。构建通过不等于扑克正确；旧单下注R1说明见[历史基准](../../docs/archive/2026-11-27/entrypoints/solver-benchmarks.before-consolidation.md)。
