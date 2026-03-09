# 维护与发版

本文面向 `ironclaw-zh` 维护者，说明仓库同步、分支流、校验流程和发版步骤。

## 当前仓库状态

- GitHub 仓库：`justinhuangcode/ironclaw-zh`
- 默认分支：`main`
- 上游远程：`upstream -> nearai/ironclaw`
- 自有远程：`origin -> justinhuangcode/ironclaw-zh`

## 分支策略

- `main`
  - 保持为可发布状态
  - 用于承接已经整理好的本地化、文档和发行层改动
- `codex/*`
  - 用于 Codex 或自动化协作分支
  - 适合承载单批次、可回滚的改动
- `feature/*` / `fix/*`
  - 适合人工维护分支

## 必跑检查

在提交 locale、Web UI 或发行层改动前，至少运行：

```bash
node ./scripts/check-locales.mjs
node ./scripts/check-forbidden-locale-ids.mjs
node ./scripts/check-i18n-keys.mjs
node --check ./src/channels/web/static/app.js
node --check ./src/channels/web/static/i18n.js
cargo check
```

如果改动触及行为或功能状态，还需要同步检查：

- `FEATURE_PARITY.md`
- 相关测试
- GitHub Actions 工作流是否仍成立

## 上游同步

推荐按下面顺序同步上游：

```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
```

如果当前存在本地化分支：

```bash
git checkout codex/your-branch
git rebase main
```

## 版本策略

`ironclaw-zh` 版本规则：

- 跟随上游 IronClaw 基础版本
- `Cargo.toml` / `Cargo.lock` 版本保持与上游一致
- Git tag / GitHub Release 在基础版本后追加 `-zh.N`

例如：

- 上游：`0.16.1`
- 包版本：`0.16.1-zh.1`
- 中文发行标签：`v0.16.1-zh.1`
- 下一次中文版发行标签：`v0.16.1-zh.2`
- 上游升级后：包版本 `0.16.2`，发行标签 `v0.16.2-zh.1`

## 发版步骤

1. 确认 `main` 已同步最新上游基线
2. 确认 locale / 文档 / Web UI 改动已经整理完成
3. 跑完必跑检查
4. 确认 `Cargo.toml` 版本正确
5. 创建 tag
6. 推送 tag

示例：

```bash
git checkout main
git pull --ff-only origin main
git tag v0.16.1-zh.1
git push origin main
git push origin v0.16.1-zh.1
```
