# Skill Deck (`skill-deck` v0.4.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://github.com/meat-daemon-404/skill-deck)
[![Tests](https://img.shields.io/badge/Vitest-197%2F197_Passing-2ea44f)](https://github.com/meat-daemon-404/skill-deck)

[English](README.md) | [简体中文](README.zh-CN.md)

> **Local-First SuperAgent Control Tower, MCP Aggregation Gateway, Self-Evolving Immune Bridge & Transactional Skill Vault** — Manage skills, MCP servers, token budgets, and `agent-immune` v3.0.0 pitfall immunity across Claude Code, Codex, Cursor, ZCode, DeepSeek Harness (DSH), Gemini CLI, and Windsurf from a single CLI and web dashboard.

## Core Capabilities

1. **Unified Multi-Agent Skill Vault (`packages/core/src/vault.ts`)**
   - Atomic, transactional skill installation, symlink/copy synchronization, snapshot rollback, and drift detection across 7 local agent harnesses.
2. **MCP Aggregation Gateway & Budget Guard (`packages/core/src/gateway.ts`)**
   - Multiplexes multiple upstream MCP servers behind a single local endpoint with per-tool latency telemetry, schema deduplication, and token cost caps.
3. **Native `agent-immune` v3.0.0 Dual-Layer Shield (`packages/core/src/agent-immune-bridge.ts`)**
   - **7-Platform Immune Store Discovery**: Automatically locates and federates SQLite antibody stores across DSH, Claude Code, Cursor, Codex, ZCode, Windsurf, and Gemini CLI (`discoverAgentImmuneStores`, `federateAgentImmuneRules`).
   - **Project DNA Lockfile Sync**: Compiles and verifies `.immune/vaccine.lock.json` (`compileVaccineLockfile`, `verifyVaccineLockfile`, `applyVaccineLockfile`) with SHA-256 integrity checks.
   - **Pre-Flight Tool Interceptor**: Evaluates every tool call before execution (`preflightCheckToolCall`) with a 0–100 blast-radius score (`allow` / `warn` / `rewrite` / `block`) and safe command rewriting.

## Monorepo Architecture

```text
skill-deck/
├── packages/
│   ├── core/                         # Core engine: Skill Vault, MCP Gateway & agent-immune v3.0 bridge
│   │   ├── src/agent-immune-bridge.ts
│   │   └── test/                     # Vitest unit & integration test suites
│   ├── cli/                          # `skill-deck` CLI for vault sync, MCP routing & immune ops
│   └── web/                          # Local control-tower dashboard UI
├── package.json
└── tsconfig.json
```

## Quick Start

```bash
git clone https://github.com/meat-daemon-404/skill-deck.git
cd skill-deck
npm install

# Run all 197 unit & integration tests across 14 test suites
npm test

# Build all packages
npm run build
```

## License

Released under the [MIT License](LICENSE).
