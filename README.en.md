<p align="center">
  <img src="ironclaw.png?v=2" alt="IronClaw" width="200"/>
</p>

<h1 align="center">ironclaw-zh</h1>

<p align="center">
  <strong>Your secure personal AI assistant, always on your side</strong>
</p>

<p align="center">
  <a href="#upstream"><img src="https://img.shields.io/badge/upstream-nearai%2Fironclaw-181717.svg" alt="Upstream: nearai/ironclaw" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT%20OR%20Apache%202.0-blue.svg" alt="License: MIT OR Apache-2.0" /></a>
  <a href="https://t.me/ironclawAI"><img src="https://img.shields.io/badge/Telegram-%40ironclawAI-26A5E4?style=flat&logo=telegram&logoColor=white" alt="Telegram: @ironclawAI" /></a>
  <a href="https://www.reddit.com/r/ironclawAI/"><img src="https://img.shields.io/badge/Reddit-r%2FironclawAI-FF4500?style=flat&logo=reddit&logoColor=white" alt="Reddit: r/ironclawAI" /></a>
</p>

<p align="center">
  <strong>Languages:</strong>
  <a href="README.en.md">English</a> |
  <a href="README.md">简体中文</a> |
  <a href="README.zh-Hant.md">繁體中文</a>
</p>

<p align="center">
  <a href="#philosophy">Philosophy</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#security">Security</a> •
  <a href="#architecture">Architecture</a>
</p>

---

> **Community-maintained** — `ironclaw-zh` is a community-maintained distribution based on [nearai/ironclaw](https://github.com/nearai/ironclaw). It focuses on Chinese user experience, local-first deployment, and preserving IronClaw's security-oriented architecture. This is not an official NEAR AI release.

## Philosophy

IronClaw is built on a simple principle: **your AI assistant should work for you, not against you**.

In a world where AI systems are increasingly opaque about data handling and aligned with corporate interests, IronClaw takes a different approach:

- **Your data stays yours** — All information is stored locally, encrypted, and never leaves your control
- **Transparency by design** — Open source, auditable, no hidden telemetry or data harvesting
- **Self-expanding capabilities** — Build new tools on the fly without waiting for vendor updates
- **Defense in depth** — Multiple security layers protect against prompt injection and data exfiltration

IronClaw is the AI assistant you can actually trust with your personal and professional life.

## Features

### Security First

- **WASM Sandbox** — Untrusted tools run in isolated WebAssembly containers with capability-based permissions
- **Credential Protection** — Secrets are never exposed to tools; injected at the host boundary with leak detection
- **Prompt Injection Defense** — Pattern detection, content sanitization, and policy enforcement
- **Endpoint Allowlisting** — HTTP requests only to explicitly approved hosts and paths

### Always Available

- **Multi-channel** — REPL, HTTP webhooks, WASM channels (Telegram, Slack), and web gateway
- **Docker Sandbox** — Isolated container execution with per-job tokens and orchestrator/worker pattern
- **Web Gateway** — Browser UI with real-time SSE/WebSocket streaming
- **Routines** — Cron schedules, event triggers, webhook handlers for background automation
- **Heartbeat System** — Proactive background execution for monitoring and maintenance tasks
- **Parallel Jobs** — Handle multiple requests concurrently with isolated contexts
- **Self-repair** — Automatic detection and recovery of stuck operations

### Self-Expanding

- **Dynamic Tool Building** — Describe what you need, and IronClaw builds it as a WASM tool
- **MCP Protocol** — Connect to Model Context Protocol servers for additional capabilities
- **Plugin Architecture** — Drop in new WASM tools and channels without restarting

### Persistent Memory

- **Hybrid Search** — Full-text + vector search using Reciprocal Rank Fusion
- **Workspace Filesystem** — Flexible path-based storage for notes, logs, and context
- **Identity Files** — Maintain consistent personality and preferences across sessions

## Installation

### Prerequisites

- Rust 1.85+
- PostgreSQL 15+ with [pgvector](https://github.com/pgvector/pgvector) extension
- NEAR AI account (authentication handled via setup wizard)

### Download or Build

Visit the [Releases page](https://github.com/justinhuangcode/ironclaw-zh/releases/) to see the latest updates.

<details>
  <summary>Install via Windows Installer (Windows)</summary>

Download the [Windows Installer](https://github.com/justinhuangcode/ironclaw-zh/releases/latest/download/ironclaw-x86_64-pc-windows-msvc.msi) and run it.

</details>

<details>
  <summary>Install via PowerShell script (Windows)</summary>

```sh
irm https://github.com/justinhuangcode/ironclaw-zh/releases/latest/download/ironclaw-installer.ps1 | iex
```

</details>

<details>
  <summary>Install via shell script (macOS, Linux, Windows/WSL)</summary>

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/justinhuangcode/ironclaw-zh/releases/latest/download/ironclaw-installer.sh | sh
```
</details>

<details>
  <summary>Compile from source (Cargo on Windows, Linux, macOS)</summary>

Make sure you have [Rust](https://rustup.rs) installed.

```bash
# Clone the repository
git clone https://github.com/justinhuangcode/ironclaw-zh.git
cd ironclaw-zh

# Build
cargo build --release

# Run tests
cargo test
```

For a **full release build** (after modifying channel sources), run `./scripts/build-all.sh` to rebuild channels first.

</details>

### Database Setup

```bash
# Create database
createdb ironclaw

# Enable pgvector
psql ironclaw -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Docs

- [Project Overview](docs/zh-Hans/overview.md)
- [Install Guide](docs/zh-Hans/install.md)
- [Configuration Guide](docs/zh-Hans/configuration.md)
- [Deployment Guide](docs/zh-Hans/deployment.md)
- [Security Guide](docs/zh-Hans/security.md)
- [Skills Guide](docs/zh-Hans/skills.md)
- [FAQ](docs/zh-Hans/faq.md)

## Configuration

Run the setup wizard to configure IronClaw:

```bash
ironclaw onboard
```

The wizard handles database connection, NEAR AI authentication (via browser OAuth), and secrets encryption (using your system keychain). Settings are persisted in the connected database; bootstrap variables (e.g. `DATABASE_URL`, `LLM_BACKEND`) are written to `~/.ironclaw/.env` so they are available before the database connects.

### Alternative LLM Providers

IronClaw defaults to NEAR AI but works with any OpenAI-compatible endpoint.
Popular options include **OpenRouter** (300+ models), **Together AI**, **Fireworks AI**, **Ollama** (local), and self-hosted servers like **vLLM** or **LiteLLM**.

Select *"OpenAI-compatible"* in the wizard, or set environment variables directly:

```env
LLM_BACKEND=openai_compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=anthropic/claude-sonnet-4
```

See [docs/LLM_PROVIDERS.md](docs/LLM_PROVIDERS.md) for a full provider guide.

## Security

IronClaw implements defense in depth to protect your data and prevent misuse.

### WASM Sandbox

All untrusted tools run in isolated WebAssembly containers:

- **Capability-based permissions** — Explicit opt-in for HTTP, secrets, tool invocation
- **Endpoint allowlisting** — HTTP requests only to approved hosts/paths
- **Credential injection** — Secrets injected at host boundary, never exposed to WASM code
- **Leak detection** — Scans requests and responses for secret exfiltration attempts
- **Rate limiting** — Per-tool request limits to prevent abuse
- **Resource limits** — Memory, CPU, and execution time constraints

```
WASM ──► Allowlist ──► Leak Scan ──► Credential ──► Execute ──► Leak Scan ──► WASM
         Validator     (request)     Injector       Request     (response)
```

### Prompt Injection Defense

External content passes through multiple security layers:

- Pattern-based detection of injection attempts
- Content sanitization and escaping
- Policy rules with severity levels (Block/Warn/Review/Sanitize)
- Tool output wrapping for safe LLM context injection

### Data Protection

- All data stored locally in your PostgreSQL database
- Secrets encrypted with AES-256-GCM
- No telemetry, analytics, or data sharing
- Full audit log of all tool executions

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          Channels                              │
│  ┌──────┐  ┌──────┐   ┌─────────────┐  ┌─────────────┐         │
│  │ REPL │  │ HTTP │   │WASM Channels│  │ Web Gateway │         │
│  └──┬───┘  └──┬───┘   └──────┬──────┘  │ (SSE + WS)  │         │
│     │         │              │         └──────┬──────┘         │
│     └─────────┴──────────────┴────────────────┘                │
│                              │                                 │
│                    ┌─────────▼─────────┐                       │
│                    │    Agent Loop     │  Intent routing       │
│                    └────┬──────────┬───┘                       │
│                         │          │                           │
│              ┌──────────▼────┐  ┌──▼───────────────┐           │
│              │  Scheduler    │  │ Routines Engine  │           │
│              │(parallel jobs)│  │(cron, event, wh) │           │
│              └──────┬────────┘  └────────┬─────────┘           │
│                     │                    │                     │
│       ┌─────────────┼────────────────────┘                     │
│       │             │                                          │
│   ┌───▼─────┐  ┌────▼────────────────┐                         │
│   │ Local   │  │    Orchestrator     │                         │
│   │Workers  │  │  ┌───────────────┐  │                         │
│   │(in-proc)│  │  │ Docker Sandbox│  │                         │
│   └───┬─────┘  │  │   Containers  │  │                         │
│       │        │  │ ┌───────────┐ │  │                         │
│       │        │  │ │Worker / CC│ │  │                         │
│       │        │  │ └───────────┘ │  │                         │
│       │        │  └───────────────┘  │                         │
│       │        └─────────┬───────────┘                         │
│       └──────────────────┤                                     │
│                          │                                     │
│              ┌───────────▼──────────┐                          │
│              │    Tool Registry     │                          │
│              │  Built-in, MCP, WASM │                          │
│              └──────────────────────┘                          │
└────────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Purpose |
|-----------|---------|
| **Agent Loop** | Main message handling and job coordination |
| **Router** | Classifies user intent (command, query, task) |
| **Scheduler** | Manages parallel job execution with priorities |
| **Worker** | Executes jobs with LLM reasoning and tool calls |
| **Orchestrator** | Container lifecycle, LLM proxying, per-job auth |
| **Web Gateway** | Browser UI with chat, memory, jobs, logs, extensions, routines |
| **Routines Engine** | Scheduled (cron) and reactive (event, webhook) background tasks |
| **Workspace** | Persistent memory with hybrid search |
| **Safety Layer** | Prompt injection defense and content sanitization |

## Usage

```bash
# First-time setup (configures database, auth, etc.)
ironclaw onboard

# Start interactive REPL
cargo run

# With debug logging
RUST_LOG=ironclaw=debug cargo run
```

## Development

```bash
# Format code
cargo fmt

# Lint
cargo clippy --all --benches --tests --examples --all-features

# Run tests
createdb ironclaw_test
cargo test

# Run specific test
cargo test test_name
```

- **Telegram channel**: See [docs/TELEGRAM_SETUP.md](docs/TELEGRAM_SETUP.md) for setup and DM pairing.
- **Changing channel sources**: Run `./channels-src/telegram/build.sh` before `cargo build` so the updated WASM is bundled.

## Versioning & Upstream

- Current package version: `0.16.1-zh.1`
- Current recommended release tag: `v0.16.1-zh.1`

### Upstream

Upstream project: [nearai/ironclaw](https://github.com/nearai/ironclaw)

This repository is maintained on top of IronClaw. Generic fixes should be proposed upstream when possible.

IronClaw is a Rust reimplementation inspired by [OpenClaw](https://github.com/openclaw/openclaw). See [FEATURE_PARITY.md](FEATURE_PARITY.md) for the complete tracking matrix.

Key differences:

- **Rust vs TypeScript** — Native performance, memory safety, single binary
- **WASM sandbox vs Docker** — Lightweight, capability-based security
- **PostgreSQL vs SQLite** — Production-ready persistence
- **Security-first design** — Multiple defense layers, credential protection

## License

This repository follows the upstream IronClaw licensing model. Licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))

at your option.
