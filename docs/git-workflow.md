# Git 基线与恢复

工作区：`E:\poker_coach`。这是本地独立仓库；尚未配置远程。

## 基线约定

- `baseline/repo-init`：仓库初始化与工作约定。
- `baseline/design-v0.1`：参考研究、产品设计、模块和 mock 约定、开发任务及评审脚本。
- `baseline/demo-v1-plan-v0.1`：已确认技术方向与待用户审阅的第一版详细任务方案；不代表批准开发。
- 后续 `baseline/demo-v1-m1`、`baseline/demo-v1-m2`、`baseline/demo-v1-m3`、`baseline/demo-v1.0`：依次对应 D01、D02/D03、D04–D07、D08 的实际完成与验证，未完成时不提前创建。
- `baseline/demo-v1-hero-v0.1`：Hero 与全范围反馈改进；`baseline/demo-v1-d02`：D02 范围编辑与版本能力。后者是任务检查点，不能替代需 D03 完成的 M2。
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
