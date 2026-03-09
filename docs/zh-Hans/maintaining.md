# 维护与发版

本文面向 `ironclaw-zh` 维护者，说明仓库同步、分支流、校验流程和发版步骤。

## 当前仓库状态

- GitHub 仓库：`justinhuangcode/ironclaw-zh`
- 默认分支：`main`
- 上游远程：`upstream -> nearai/ironclaw`
- 自有远程：`origin -> justinhuangcode/ironclaw-zh`

## 分支策略

- `main`
  - 稳定分支，只包含已发布或已合并的代码
  - 设有分支保护：必须通过 PR 合并，必须通过 CI
  - 禁止 force push 和直接推送
- `dev/<upstream-version>-zh`
  - 开发集成分支，例如 `dev/0.16.1-zh`
  - 长期存在，贯穿该上游版本的所有 zh 发行（zh.1、zh.2、zh.3…）
  - 接收 feature/fix 分支的合并
- `release/<upstream-version>-zh.<n>`
  - 发布准备分支，例如 `release/0.16.1-zh.1`
  - 从 dev 切出，只做版本号变更和最终修复
  - 合并到 main 后删除
- `feature/*` / `fix/*`
  - 适合人工维护的功能或修复分支
  - 合并到 dev 分支

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

如果当前存在开发分支：

```bash
git checkout dev/0.16.1-zh
git rebase main
```

## 版本策略

`ironclaw-zh` 版本规则：

- `Cargo.toml` 版本使用 `<上游版本>-zh.<n>` 格式（例如 `0.16.1-zh.1`）
- 这是 SemVer 合法的 pre-release 标识
- Git tag 使用 `v` 前缀（例如 `v0.16.1-zh.1`）
- cargo-dist 要求 tag 版本与 `Cargo.toml` 版本一致

例如：

- 上游版本：`0.16.1`
- Cargo.toml 版本：`0.16.1-zh.1`
- Git tag：`v0.16.1-zh.1`
- 下一次 zh 发行：Cargo.toml `0.16.1-zh.2`，tag `v0.16.1-zh.2`
- 上游升级后：Cargo.toml `0.16.2-zh.1`，tag `v0.16.2-zh.1`

需要同步更新版本号的文件：

- `Cargo.toml`（`version` 字段）
- `Cargo.lock`（ironclaw 条目）
- `README.md`、`README.en.md`、`README.zh-Hans.md`、`README.zh-Hant.md`（版本段落）

## 发版步骤

### 1. 准备开发分支

```bash
git checkout dev/<version>-zh
# 确认所有功能和修复已合并
```

### 2. 切出发布分支

```bash
git checkout -b release/<version>-zh.<n> dev/<version>-zh
```

### 3. 在发布分支上变更版本号

更新 `Cargo.toml`、`Cargo.lock`、所有 README 中的版本号。

### 4. 提交并创建 PR

```bash
git add Cargo.toml Cargo.lock README.md README.en.md README.zh-Hans.md README.zh-Hant.md
git commit -m "chore(release): bump package version to <version>-zh.<n>"
git push -u origin release/<version>-zh.<n>
gh pr create --base main --title "release: v<version>-zh.<n>"
```

### 5. 等待 CI 通过并合并

确认所有必要的状态检查通过后，合并 PR。

### 6. 打标签并推送

```bash
git checkout main
git pull --ff-only origin main
git tag -a v<version>-zh.<n> -m "Release v<version>-zh.<n>"
git push origin v<version>-zh.<n>
```

使用 annotated tag（`-a`），不使用 lightweight tag。

### 7. 验证 Release 工作流

推送 tag 后，`release.yml` 工作流将自动：

- 运行 cargo-dist plan
- 构建 WASM 扩展
- 构建 5 个平台的二进制
- 创建 GitHub Release 并上传产物

### 8. 补充 Release Notes

cargo-dist 创建的 Release 默认没有 body（因为不读 zh 的 CHANGELOG）。发布后手动补充：

```bash
gh release edit v<version>-zh.<n> --notes "Release notes content..."
```

### 9. 清理

- 合并 checksums PR（如有）
- 删除 release 分支
- 将 release 分支合并回 dev（如有新提交）
