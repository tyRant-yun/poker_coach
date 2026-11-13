# 仓库归档与 GitHub 备份

日期：2026-11-13（Asia/Shanghai）。用户授权打包仓库、创建 GitHub 项目并上传、保存各个基线。

## 保存范围

- 私有仓库：<https://github.com/tyRant-yun/poker_coach>，远程名 `origin`。
- 上传本地 `main`、`demo/development` 两个分支及全部基线标签；默认分支使用当前产品分支 `demo/development`。`main` 仍保留原设计基线，不强制移动。
- 原有 16 个基线标签及其目标保持不变。新增 `baseline/archive-2026-11-13` 仅标记本次源码与文档归档，不代表新增功能验收。
- 保存已有未提交的 `docs/demo-learner-experience-review.md`；此次仅归档与文档整理，没有修改应用或重新运行应用测试。功能验收沿用各交付记录。
- 独立目录 `E:\poker_coach-backups` 下按时间创建本次备份：源码 ZIP、包含所有分支与标签的 Git bundle、ref 清单及 SHA-256 校验清单。
- 源码 ZIP 包含归档提交中的全部文件，不包含依赖、构建产物、日志、`.data/`、`.artifacts/`、浏览器 IndexedDB、机器配置或密钥。运行中的学习记录/工作区数据需要应用自身另行导出；此次没有打包这些数据。
- 上传前检查文件和历史中的常见密钥格式，没有发现匹配项；不将该检查等同于完整安全审计。

## 既有基线（完整提交）

| 标签 | 提交 |
|---|---|
| `baseline/demo-v1-d02` | `a9938d8c5572d57c398834d0595e50ab653589f7` |
| `baseline/demo-v1-hero-v0.1` | `9fcd2e860ac87a8c3346dca652601da2e6d96107` |
| `baseline/demo-v1-m1` | `5cc1b21501885b8e9e77b27d632d16a97fe79947` |
| `baseline/demo-v1-m2` | `163d27901587a59b365045febc501a2af9994b57` |
| `baseline/demo-v1-m3` | `163d27901587a59b365045febc501a2af9994b57` |
| `baseline/demo-v1-plan-v0.1` | `00d9e4e09e88f59e5202af67843fb317836aa02d` |
| `baseline/demo-v1-plan-v0.2` | `361595396b3c107348bb27b2f890e408d26269e8` |
| `baseline/demo-v1.0` | `163d27901587a59b365045febc501a2af9994b57` |
| `baseline/design-v0.1` | `9d6c31da67aed88e48caed37b93b809809888c00` |
| `baseline/repo-init` | `a9671bd337de69032a26a5814fbad18ae8453177` |
| `baseline/solver-s1.0` | `e92f812d12f8c17fbfb245b305215a1bb34c5760` |
| `baseline/solver-s1.0.1` | `5346ad5a0e1233903b0a5893508dc906c6c0cd31` |
| `baseline/teaching-t1-design-v0.1` | `66fe0e6e68cda0587619b8ad8865e46673def63f` |
| `baseline/teaching-t1-design-v0.2` | `3df22fd9c63c93c327798f8f1dd5cddd2efff248` |
| `baseline/teaching-t1-m1` | `3503f070d6d7406efd8bd85a4ba8d7883bd47166` |
| `baseline/teaching-t1.0` | `ca73e3db4d6708aa4de5cf3e6f8a616a8d7349a2` |

## 恢复与核验

GitHub 上可从任一标签查看固定版本；源码 ZIP 仅保存当前快照，完整历史使用 bundle 或远程克隆。

```powershell
# 在新目录恢复全部历史；不要覆盖当前工作区。
git clone E:\poker_coach-backups\<本次目录>\poker_coach.bundle E:\poker_coach-restored
git -C E:\poker_coach-restored tag --list 'baseline/*'
# 若从 GitHub 恢复：
git clone https://github.com/tyRant-yun/poker_coach.git E:\poker_coach-github-restored
# 独立回看具体基线（目标目录应不存在）：
git worktree add --detach E:\poker_coach-baseline-review baseline/solver-s1.0.1
```

备份目录内的 `refs.txt` 保存全部分支/标签对象及其目标，`SHA256SUMS.txt` 用于校验包内容。Git bundle 在生成后验证，并通过临时镜像克隆比对全部分支与标签；远程上传后逐项比对 ref，结果在本次交付回复中说明。
