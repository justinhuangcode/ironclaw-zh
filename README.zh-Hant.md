<p align="center">
  <img src="ironclaw.png?v=2" alt="IronClaw" width="200"/>
</p>

<h1 align="center">ironclaw-zh</h1>

<p align="center">
  <strong>安全可靠的個人 AI 助手，始終站在你這邊</strong>
</p>

<p align="center">
  <a href="#上游專案"><img src="https://img.shields.io/badge/upstream-nearai%2Fironclaw-181717.svg" alt="Upstream: nearai/ironclaw" /></a>
  <a href="#授權"><img src="https://img.shields.io/badge/license-MIT%20OR%20Apache%202.0-blue.svg" alt="License: MIT OR Apache-2.0" /></a>
  <a href="https://t.me/ironclawAI"><img src="https://img.shields.io/badge/Telegram-%40ironclawAI-26A5E4?style=flat&logo=telegram&logoColor=white" alt="Telegram: @ironclawAI" /></a>
  <a href="https://www.reddit.com/r/ironclawAI/"><img src="https://img.shields.io/badge/Reddit-r%2FironclawAI-FF4500?style=flat&logo=reddit&logoColor=white" alt="Reddit: r/ironclawAI" /></a>
</p>

<p align="center">
  <strong>語言切換：</strong>
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zh-Hant.md">繁體中文</a>
</p>

<p align="center">
  <a href="#設計理念">設計理念</a> •
  <a href="#功能特性">功能特性</a> •
  <a href="#安裝">安裝</a> •
  <a href="#設定">設定</a> •
  <a href="#安全機制">安全機制</a> •
  <a href="#系統架構">系統架構</a>
</p>

---

> **社群維護版本** — `ironclaw-zh` 是基於 [nearai/ironclaw](https://github.com/nearai/ironclaw) 的社群維護發行版，重點面向中文體驗、本地優先部署與對上游安全架構的保留。本專案不是 NEAR AI 官方發行版。

## 設計理念

IronClaw 基於一個簡單的原則：**你的 AI 助手應該為你服務，而不是與你為敵。**

在 AI 系統對資料處理日益不透明、與企業利益綁定的今天，IronClaw 選擇了一條不同的路：

- **資料歸你所有** — 所有資訊儲存在本地，加密保護，始終在你掌控之下
- **透明至上** — 完全開源，可稽核，沒有隱藏的遙測或資料收集
- **自主擴展** — 隨時建構新工具，無需等待供應商更新
- **縱深防禦** — 多層安全機制抵禦提示注入和資料洩露

IronClaw 是一個你真正可以信賴的 AI 助手，無論是個人生活還是工作。

## 功能特性

### 安全優先

- **WASM 沙箱** — 不受信任的工具在隔離的 WebAssembly 容器中運行，採用基於能力的權限模型
- **憑據保護** — 密鑰永遠不會暴露給工具；在宿主邊界注入並進行洩露檢測
- **提示注入防禦** — 模式檢測、內容清理和策略執行
- **端點白名單** — HTTP 請求僅限於明確批准的主機和路徑

### 隨時可用

- **多渠道接入** — REPL、HTTP webhook、WASM 渠道（Telegram、Slack）和 Web 閘道
- **Docker 沙箱** — 隔離的容器執行，支援每任務令牌和編排器/工作器模式
- **Web 閘道** — 瀏覽器 UI，支援即時 SSE/WebSocket 串流傳輸
- **定時任務** — Cron 排程、事件觸發器、Webhook 處理器，實現後台自動化
- **心跳系統** — 主動後台執行，用於監控和維護任務
- **並行任務** — 使用隔離上下文同時處理多個請求
- **自修復** — 自動檢測並恢復卡住的操作

### 自主擴展

- **動態工具建構** — 描述你的需求，IronClaw 會將其建構為 WASM 工具
- **MCP 協定** — 連接模型上下文協定（Model Context Protocol）伺服器以獲取額外能力
- **外掛架構** — 無需重啟即可載入新的 WASM 工具和渠道

### 持久記憶

- **混合搜尋** — 全文搜尋 + 向量搜尋，採用倒數排名融合（Reciprocal Rank Fusion）
- **工作空間檔案系統** — 靈活的基於路徑的儲存，用於筆記、日誌和上下文
- **身份檔案** — 跨工作階段保持一致的個性和偏好設定

## 安裝

### 前置要求

- Rust 1.85+
- PostgreSQL 15+，需安裝 [pgvector](https://github.com/pgvector/pgvector) 擴充功能
- NEAR AI 帳戶（透過設定精靈進行身份驗證）

### 下載或編譯

造訪 [Releases 頁面](https://github.com/justinhuangcode/ironclaw-zh/releases/) 查看最新版本。

<details>
  <summary>透過 Windows 安裝程式安裝 (Windows)</summary>

下載 [Windows 安裝程式](https://github.com/justinhuangcode/ironclaw-zh/releases/latest/download/ironclaw-x86_64-pc-windows-msvc.msi) 並執行。

</details>

<details>
  <summary>透過 PowerShell 指令碼安裝 (Windows)</summary>

```sh
irm https://github.com/justinhuangcode/ironclaw-zh/releases/latest/download/ironclaw-installer.ps1 | iex
```

</details>

<details>
  <summary>透過 Shell 指令碼安裝 (macOS、Linux、Windows/WSL)</summary>

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/justinhuangcode/ironclaw-zh/releases/latest/download/ironclaw-installer.sh | sh
```
</details>

<details>
  <summary>透過 Homebrew 安裝 (macOS/Linux)</summary>

```sh
brew install ironclaw
```

</details>

<details>
  <summary>從原始碼編譯 (Windows、Linux、macOS 上使用 Cargo)</summary>

確保你已安裝 [Rust](https://rustup.rs)。

```bash
# 複製倉庫
git clone https://github.com/justinhuangcode/ironclaw-zh.git
cd ironclaw-zh

# 編譯
cargo build --release

# 執行測試
cargo test
```

如需進行**完整發布建構**（修改了渠道原始碼後），先執行 `./scripts/build-all.sh` 重新編譯渠道。

</details>

### 資料庫設定

```bash
# 建立資料庫
createdb ironclaw

# 啟用 pgvector 擴充功能
psql ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## 文件

- [專案概覽](docs/zh-Hans/overview.md)
- [安裝指南](docs/zh-Hans/install.md)
- [設定指南](docs/zh-Hans/configuration.md)
- [部署指南](docs/zh-Hans/deployment.md)
- [安全說明](docs/zh-Hans/security.md)
- [技能說明](docs/zh-Hans/skills.md)
- [常見問題](docs/zh-Hans/faq.md)

## 設定

執行設定精靈來設定 IronClaw：

```bash
ironclaw onboard
```

精靈將引導你完成資料庫連線、NEAR AI 身份驗證（透過瀏覽器 OAuth）和密鑰加密（使用系統鑰匙圈）。設定會儲存在資料庫中；引導變數（如 `DATABASE_URL`、`LLM_BACKEND`）寫入 `~/.ironclaw/.env`，以便在資料庫連線前可用。

### 替代 LLM 提供商

IronClaw 預設使用 NEAR AI，但相容任何 OpenAI 相容的端點。
常用選項包括 **OpenRouter**（300+ 模型）、**Together AI**、**Fireworks AI**、**Ollama**（本地部署）以及自託管伺服器如 **vLLM** 或 **LiteLLM**。

在精靈中選擇 *「OpenAI-compatible」*，或直接設定環境變數：

```env
LLM_BACKEND=openai_compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=anthropic/claude-sonnet-4
```

詳見 [docs/LLM_PROVIDERS.md](docs/LLM_PROVIDERS.md) 取得完整的提供商指南。

## 安全機制

IronClaw 實現了縱深防禦策略來保護你的資料並防止濫用。

### WASM 沙箱

所有不受信任的工具都在隔離的 WebAssembly 容器中運行：

- **基於能力的權限** — 明確授權 HTTP、密鑰、工具調用等能力
- **端點白名單** — HTTP 請求僅限已批准的主機和路徑
- **憑據注入** — 密鑰在宿主邊界注入，永遠不會暴露給 WASM 程式碼
- **洩露檢測** — 掃描請求和回應以防止密鑰外洩
- **速率限制** — 每個工具獨立的請求限制，防止濫用
- **資源限制** — 記憶體、CPU 和執行時間約束

```
WASM ──► 白名單  ──► 洩露掃描 ──► 憑據  ──► 執行  ──► 洩露掃描 ──► WASM
         驗證器     (請求)      注入器    請求     (回應)
```

### 提示注入防禦

外部內容需通過多個安全層：

- 基於模式的注入嘗試檢測
- 內容清理和跳脫
- 帶嚴重級別的策略規則（阻止/警告/稽核/清理）
- 工具輸出包裝，確保安全的 LLM 上下文注入

### 資料保護

- 所有資料儲存在本地 PostgreSQL 資料庫中
- 密鑰使用 AES-256-GCM 加密
- 無遙測、無分析、無資料共享
- 所有工具執行的完整稽核日誌

## 系統架構

```
┌────────────────────────────────────────────────────────────────┐
│                            渠道                                 │
│  ┌──────┐  ┌──────┐   ┌─────────────┐  ┌─────────────┐         │
│  │ REPL │  │ HTTP │   │ WASM 渠道   │  │  Web 閘道   │         │
│  └──┬───┘  └──┬───┘   └──────┬──────┘  │ (SSE + WS)  │         │
│     │         │              │         └──────┬──────┘         │
│     └─────────┴──────────────┴────────────────┘                │
│                              │                                 │
│                    ┌─────────▼─────────┐                       │
│                    │    代理迴圈       │  意圖路由              │
│                    └────┬──────────┬───┘                       │
│                         │          │                           │
│              ┌──────────▼────┐  ┌──▼───────────────┐           │
│              │    排程器      │  │   定時任務引擎    │           │
│              │  (並行任務)    │  │(cron, 事件, wh)  │           │
│              └──────┬────────┘  └────────┬─────────┘           │
│                     │                    │                     │
│       ┌─────────────┼────────────────────┘                     │
│       │             │                                          │
│   ┌───▼─────┐  ┌────▼────────────────┐                         │
│   │  本地   │  │      編排器          │                         │
│   │ 工作器  │  │  ┌───────────────┐  │                         │
│   │(行程內) │  │  │ Docker 沙箱   │  │                         │
│   └───┬─────┘  │  │     容器      │  │                         │
│       │        │  │ ┌───────────┐ │  │                         │
│       │        │  │ │工作器/CC  │ │  │                         │
│       │        │  │ └───────────┘ │  │                         │
│       │        │  └───────────────┘  │                         │
│       │        └─────────┬───────────┘                         │
│       └──────────────────┤                                     │
│                          │                                     │
│              ┌───────────▼──────────┐                          │
│              │      工具註冊表       │                          │
│              │ 內建、MCP、WASM      │                          │
│              └──────────────────────┘                          │
└────────────────────────────────────────────────────────────────┘
```

### 核心元件

| 元件 | 用途 |
|------|------|
| **代理迴圈** | 主訊息處理和任務協調 |
| **路由器** | 分類使用者意圖（命令、查詢、任務） |
| **排程器** | 管理帶優先級的並行任務執行 |
| **工作器** | 執行包含 LLM 推理和工具調用的任務 |
| **編排器** | 容器生命週期、LLM 代理、每任務認證 |
| **Web 閘道** | 瀏覽器 UI，含聊天、記憶、任務、日誌、擴充功能、定時任務 |
| **定時任務引擎** | 定時（cron）和響應式（事件、webhook）後台任務 |
| **工作空間** | 帶混合搜尋的持久記憶 |
| **安全層** | 提示注入防禦和內容清理 |

## 使用方式

```bash
# 首次設定（設定資料庫、認證等）
ironclaw onboard

# 啟動互動式 REPL
cargo run

# 啟用除錯日誌
RUST_LOG=ironclaw=debug cargo run
```

## 開發

```bash
# 格式化程式碼
cargo fmt

# 程式碼檢查
cargo clippy --all --benches --tests --examples --all-features

# 執行測試
createdb ironclaw_test
cargo test

# 執行指定測試
cargo test test_name
```

- **Telegram 渠道**：參見 [docs/TELEGRAM_SETUP.md](docs/TELEGRAM_SETUP.md) 了解設定和私訊配對。
- **修改渠道原始碼**：在 `cargo build` 之前執行 `./channels-src/telegram/build.sh` 以便打包更新後的 WASM。

## 版本與上游

- 目前套件版本：`0.16.1-zh.1`
- 目前建議發行標籤：`v0.16.1-zh.1`

### 上游專案

上游專案：[nearai/ironclaw](https://github.com/nearai/ironclaw)

本倉庫基於上游 IronClaw 維護，通用修復會盡量優先回提上游。

IronClaw 是受 [OpenClaw](https://github.com/openclaw/openclaw) 啟發的 Rust 重新實現。參見 [FEATURE_PARITY.md](FEATURE_PARITY.md) 了解完整的功能追蹤矩陣。

主要差異：

- **Rust vs TypeScript** — 原生效能、記憶體安全、單一二進位檔案
- **WASM 沙箱 vs Docker** — 輕量級、基於能力的安全機制
- **PostgreSQL vs SQLite** — 生產級持久化儲存
- **安全優先設計** — 多層防禦、憑據保護

## 授權

本倉庫沿用上游授權模式，可選擇以下任一授權條款：

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))
