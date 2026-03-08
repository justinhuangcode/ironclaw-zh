# 安装

本文介绍 `ironclaw-zh` 的通用安装思路。当前建议优先沿用上游 IronClaw 的安装方式，再叠加 `ironclaw-zh` 的中文文档、中文 locale 和发行层增强。

## 安装原则

- 先装可运行的 IronClaw 基线
- 再叠加中文本地化层
- 先最小可用，再逐步扩展能力

## 基础依赖

大多数环境下至少需要：

- Rust 或上游提供的预编译安装方式
- 一个可用的 LLM 提供方或兼容接口
- 一个可用的数据库后端
- 可选：Docker，用于更完整的沙箱能力

## 获取方式

可以先参考上游仓库：

- [nearai/ironclaw](https://github.com/nearai/ironclaw)

也可以从源码构建：

```bash
git clone https://github.com/nearai/ironclaw.git
cd ironclaw
cargo build --release
```

如果你维护的是 `ironclaw-zh` 自身仓库，则用你自己的仓库地址替代上面的 upstream 地址。

## 初始化配置

安装完成后，建议先运行：

```bash
ironclaw onboard
```

初始化通常包括：

- 数据库连接
- LLM 提供方配置
- 密钥与凭证管理
- 基础运行参数

## 数据库选择

推荐两条路径：

- PostgreSQL：适合长期运行和更完整能力
- libsql：适合轻量起步和本地单机

建议初次部署优先从简单可跑的方案开始。

## 模型提供方选择

推荐优先选择：

- 配置简单
- 中文能力稳定
- 后续可替换

常见路径包括：

- 本地模型
- OpenAI-compatible 接口
- 上游默认支持提供方
