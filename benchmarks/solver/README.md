# R1 独立河牌基准

2026-11-27 AF：新增 `npm run benchmark:solver:flop`，4个固定翻牌问题，独立7张牌枚举、LP/BR及固定私牌三街反向递推。`scripts/solver-flop-capacity.ps1` 默认逐组测16/64/128与全合法组合的不同深度，独立保留超预算失败；全组合简化树不等于全范围三街通过。公开短筹码数据核验可运行 `.artifacts/solver/oracle-venv/Scripts/python.exe benchmarks/solver/audit_preflop_candidate.py .artifacts/af/data`（先将两个保留原字节的文件复制至该隔离目录），不将输出写回原始数据目录。实际证据与边界见[AF本轮交付](../../docs/riverline-auto-feedback-delivery-2026-11-27.md)和[数据获取报告](../../docs/riverline-preflop-data-acquisition-2026-11-27.md)。

2026-11-26：`npm run benchmark:solver:turn`增加6个冻结转牌问题与4项oracle自测；独立序列式LP/BR不让转牌信息集获知未来河牌，逐节点核验权益、EV、行动价值与条件机会概率。Windows沿用资源runner采样进程峰值工作集。完整输出只保留`.artifacts/solver/turn-n06`，小型[数值/资源摘要](../../docs/solver/validation/round2-turn-evidence-2026-11-26.json)随源码保存。产品已开放有限转牌及一般河牌，实际边界见[第二轮交付](../../docs/riverline-round2-delivery-2026-11-26.md)；下文2026-11-18“尚未开放UI/MCP”为历史检查点。oracle虚拟环境仍按下文固定requirements安装，Linux运行路径适配未做部署验收。

2026-11-18 扩展：[一般河牌树独立验证与原生查询](../../docs/solver/validation/r2-river-tree-2026-11-18.md)。`npm run benchmark:solver:tree` 运行新增六个固定问题和五项 oracle 自测；`npm run benchmark:solver:small` 保持下文原四个受限问题及两项自测。两套门槛与输入独立保存，一般树尚未开放给 UI/MCP。

固定模型：两名玩家、完整五张公共牌、给定范围的独立权重乘积在合法不重叠私牌上条件化；OOP check 或一个显式下注，IP 面对下注 fold/call，check 后双方摊牌。无抽水、无 raise、无后续价值近似。不能由这些测试宣称全 HU 翻后/翻前/六人已通过。

`river-cases.json` 在第一次基准运行前登记输入、预算与验收门槛。上游算法不修改；Rust 外壳拒绝未覆盖树、非法卡牌、重复组合以及不能精确表示为整数 centibb 的下注。

从仓库根目录：

```powershell
node scripts/solver-tool.mjs build
node scripts/solver-tool.mjs test
node scripts/solver-tool.mjs fmt
node scripts/solver-tool.mjs clippy
python -m venv .artifacts/solver/oracle-venv
& .artifacts/solver/oracle-venv/Scripts/python.exe -m pip install -r benchmarks/solver/requirements.txt
pwsh -NoProfile -File benchmarks/solver/run-river.ps1
& .artifacts/solver/oracle-venv/Scripts/python.exe benchmarks/solver/verify_river.py .artifacts/solver/r1
& .artifacts/solver/oracle-venv/Scripts/python.exe benchmarks/solver/test_oracle.py
```

Windows 需要 MSVC x64 C++ 工具和 Windows SDK；脚本只在当前子进程加载其环境。若机器配置了不可达代理，可显式设置 `$env:RIVERLINE_SOLVER_DIRECT_NETWORK='1'`；如已配置 GitHub SSH 访问而 HTTPS Git 不通，可设置 `$env:RIVERLINE_SOLVER_GIT_SSH='1'`。二者只影响构建子进程，默认不改用户网络设置。Rust 命令通过脚本在 `engines/postflop` 执行，确保使用其工具链；仅在仓库根运行 `cargo --manifest-path ...` 不会自动选中子目录工具链。

Python 独立计算 21 个五张子集的七张牌比较、合法联合发牌权重、各纯策略的收益矩阵，并用 HiGHS LP 求博弈价值；另枚举双方最佳响应。它不使用引擎的评估器、终局 payoff 或 BR。oracle 自测覆盖九种牌型及故意破坏输出的拒绝。

质量：NashConv 为双方单边最佳响应增益之和；在本无抽水零和模型下，上游 exploitability 是其一半。金额和引擎输出原单位为 centibb；`compute_current_ev` 使用减根底池一半后的零和原点；节点解释器 EV 是当前节点之后的净收益，已投入视为沉没。换回根节点净收益需减去该玩家路径已投入。独立基准分别核对根 EV、action EV 和非零到达终局 EV。

完整输入/原始报告/原生二进制/执行哈希放 `.artifacts/solver/r1`；小型机器可读验收摘要随报告提交。报告将执行结束、迭代上限、引擎目标与独立验收分开。原生解只验证读取，未提供继续 CFR 迭代承诺。PeakWorkingSet64 的轮询未观测到短进程时返回 null；它不等于求解器的内存估计，也不是精确的跨机器性能承诺。
