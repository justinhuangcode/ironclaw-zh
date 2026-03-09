# 安装

本文介绍 `ironclaw-zh` 发行版的安装方式。

## 基础依赖

- 一个可用的 LLM 提供方或兼容接口
- 一个可用的数据库后端（推荐 libsql 起步，PostgreSQL 长期运行）
- 可选：Docker，用于更完整的沙箱能力

## 方式一：从 GitHub Releases 安装（推荐）

前往 [ironclaw-zh Releases](https://github.com/justinhuangcode/ironclaw-zh/releases) 下载对应平台的预编译二进制。

支持平台：

- `aarch64-apple-darwin`（Apple Silicon macOS）
- `x86_64-apple-darwin`（Intel macOS）
- `aarch64-unknown-linux-gnu`（ARM64 Linux）
- `x86_64-unknown-linux-gnu`（x86_64 Linux）
- `x86_64-pc-windows-msvc`（Windows）

下载后解压，将 `ironclaw` 可执行文件放入 `PATH` 即可。

## 方式二：从源码构建

需要 Rust 1.92 或更高版本。

```bash
git clone https://github.com/justinhuangcode/ironclaw-zh.git
cd ironclaw-zh
cargo build --release
```

构建完成后，二进制位于 `target/release/ironclaw`。

## 初始化配置

安装完成后，运行：

```bash
ironclaw onboard
```

初始化流程包括：

- 数据库连接配置
- LLM 提供方选择
- 密钥与凭证管理
- 基础运行参数

## 数据库选择

推荐两条路径：

- **libsql**：适合轻量起步和本地单机，零配置启动
- **PostgreSQL**：适合长期运行和更完整能力

建议初次部署从 libsql 开始。

## 模型提供方选择

推荐优先考虑：

- 中文能力稳定
- 配置简单
- 后续可替换

常见路径包括：

- 本地模型（Ollama）
- OpenAI-compatible 接口（OpenRouter、Together AI 等）
- Anthropic（Claude）
- OpenAI

详见 [LLM 提供方配置](../LLM_PROVIDERS.md)。

## 验证安装

```bash
ironclaw --version
```

应输出当前发行版本号。
