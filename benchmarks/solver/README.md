# R1 独立河牌基准

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
