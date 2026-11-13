# Git 基线与恢复

工作区：`E:\poker_coach`。这是本地独立仓库；尚未配置远程。

## 基线约定

- `baseline/repo-init`：仓库初始化与工作约定。
- `baseline/design-v0.1`：参考研究、产品设计、模块和 mock 约定、开发任务及评审脚本。
- `baseline/demo-v1-plan-v0.1`：已确认技术方向与待用户审阅的第一版详细任务方案；不代表批准开发。
- 后续 `baseline/demo-v1-m1`、`baseline/demo-v1-m2`、`baseline/demo-v1-m3`、`baseline/demo-v1.0`：依次对应 D01、D02/D03、D04–D07、D08 的实际完成与验证，未完成时不提前创建。
- `baseline/demo-v1-hero-v0.1`：Hero 与全范围反馈改进；`baseline/demo-v1-d02`：D02 范围编辑与版本能力。后者是任务检查点，不能替代需 D03 完成的 M2。
- `baseline/demo-v1-plan-v0.2`：单次连续推进 D03–D08 的执行安排，记录牌面显示与研究体验反馈；只表示文档计划已更新，不表示功能完成，也不新设审批门。
- `baseline/teaching-t1-design-v0.1/v0.2` 保存教学设计；`baseline/teaching-t1-m1` 与 `baseline/teaching-t1.0` 在 2026-11-12 实际验收后保存教学闭环与整轮交付，旧标签不移动。新工作区使用 `riverline-demo-t1`，旧 `riverline-demo` 仅只读迁移，回滚代码不自动倒写或合并浏览器数据。
- 标签创建后不移动；修订使用新标签，例如 `baseline/design-v0.2`。
- `main` 保存已记录的基线；`demo/development` 用于后续开发。设计基线不等于用户已验收产品。

## 查看状态与历史

```powershell
git status --short --branch
git log --oneline --decorate -12
git tag --list 'baseline/*'
git show baseline/design-v0.1:README.md
git diff baseline/design-v0.1..HEAD --stat
```

## 保存一个检查点

先查看差异，再只暂存属于本任务的文件。提交前检查暂存区不包含密钥或生成文件。

```powershell
git status --short
git diff
git add -- <本次修改的文件>
git diff --cached --stat
git commit -m "feat(demo): describe the completed journey"
```

## 无损回看旧基线

优先使用独立 worktree，不改变当前分支及未提交工作。目标目录必须尚不存在；每次使用新的目录名。

```powershell
git worktree add --detach E:\poker_coach-baseline-review baseline/design-v0.1
```

如果不需要第二份工作区，可先保存当前修改，再从标签建立新的恢复分支。以下分支名必须尚不存在：

```powershell
git status --short
# 确认工作区干净；否则先提交自己的修改，再继续。
git switch -c recovery/design-v0.1 baseline/design-v0.1
```

## 撤销已提交的某次改动

在工作区干净、确认目标提交及依赖后，用新的反向提交保留历史。合并提交需要单独分析，不直接套用。

```powershell
git revert <需要撤销的普通提交SHA>
```

若发生冲突，解决后执行 `git revert --continue`；放弃本次回滚可执行 `git revert --abort`。

默认不使用 `reset --hard`、`clean -fd` 或强制移动基线标签。Git 只保护已经提交的内容，也不替代独立备份。未推送到远程意味着当前副本仍只保存在本机。

## 第一版完整 Demo 的实际记录

本次从 `baseline/demo-v1-plan-v0.2` 连续推进，C1 提交 `51a18ce`，C2 提交 `0a5deed`。C3 和最终恢复/隔离修复在最终提交记录；全部 57 项状态测试、20 条浏览器旅程与构建通过后，`baseline/demo-v1-m2`、`baseline/demo-v1-m3`、`baseline/demo-v1.0` 共同指向最终提交。旧标签不移动，早期 C1/C2 并非整版验收基线。

可只读核对最终基线：

```powershell
git show --stat baseline/demo-v1.0
git rev-parse 'baseline/demo-v1.0^{commit}'
```

需要回看整版时，在确认目标目录不存在后使用 `git worktree add --detach E:\poker_coach-v1-review baseline/demo-v1.0`；不覆盖当前工作区。此处仅提供恢复方法，未声称已新建该工作区或远程备份。

## T1 教学设计检查点

`baseline/teaching-t1-design-v0.1` 保存下一轮教学升级的产品、内容、领域和任务设计，仅表示文档设计完成。新应用功能、内容 fixture 和验收尚未完成；`baseline/teaching-t1-m1`、`baseline/teaching-t1.0` 留待实际开发后按条件创建。旧第一版标签不移动。

T1 独立本地库与 schema2 仍只是设计。当前应用仍使用旧数据库，不能提前声称数据已迁移；未来回看旧代码时按 T1 领域合同说明新旧库的历史边界。

`baseline/teaching-t1-design-v0.2` 另存用户新增的理论知识库与 Agent 引用设计，包含 TE09/TJ11–TJ13；v0.1 标签不移动。知识正文、检索和引用功能尚未实现，两个标签都只表示设计状态。

## S1 的实际本地交付

2026-11-13，SO01–SO09 的本地 Mock 实现完成，105 项状态测试、全部 46 工具实际 MCP 调用/3 项协议测试、44 条浏览器旅程（35 原版＋9 S1）、类型检查与构建通过。实现检查点为 `a95ee58`，新标签 `baseline/solver-s1.0` 指向整轮验证后的最终提交；旧标签不移动。范围/限制和生成证据见 `solver-s1-delivery.md`；R1–R3 没有执行，不属于该基线的真实求解能力。

整轮提交 `e92f812` 保留在 `baseline/solver-s1.0`。默认工作区约 190MB 日志恢复超过原启动九秒等待，后续启动等待修复经现存目录实际恢复/查询验证后另存 `baseline/solver-s1.0.1`，没有移动原标签。
