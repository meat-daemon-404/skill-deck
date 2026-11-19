# SkillDeck

**Local-first Control Tower for AI Agent Skills (`SKILL.md`), MCP Servers (`mcpServers`), Context Token Budgets, Trigger Conflict Detection, and Visual Workflow Composition.**

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-0284c7.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-047857.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org)
[![Local-First](https://img.shields.io/badge/Privacy-100%25%20Local--First-6d28d9.svg)](#privacy--security)

---

## Why SkillDeck?

Modern coding agents (**Antigravity**, **Claude Code**, **Cursor**, **Gemini CLI**, **OpenAI Codex**) all converge on the open **Agent Skills (`SKILL.md`)** and **Model Context Protocol (`mcpServers`)** ecosystem. Once you install dozens of skills and MCP servers across tools, four invisible problems show up fast:

1. **Silent Context Budget Bloat** — Oversized `description` frontmatter and unused MCP server schemas quietly burn thousands of always-on tokens on every single turn.
2. **Trigger Collisions** — Two skills competing on the same keywords or phrases cause unpredictable routing.
3. **Hardcoded Secret Leaks & Spec Drift** — Plaintext API keys inside `.mcp.json`, broken local reference links, mismatched folder names, and missing CLI binaries on `PATH`.
4. **Platform Fragmentation** — Copying and converting skills/MCP configs across Claude Code, Cursor, Gemini CLI, and Antigravity by hand.

**SkillDeck** gives you a single, 100% local, zero-telemetry CLI + interactive Web Control Tower to see, test, lint, compose, and export your entire AI agent stack.

---

## Key Features

- **Multi-Platform Read-Only Discovery**: Automatically scans `.gemini/`, `.claude/`, `.cursor/`, `.codex/`, and custom directories (plus a bundled bilingual **Demo Workspace** so you can explore immediately).
- **Startup vs. On-Demand Context Token Heatmap**: Calibrated bilingual (English + CJK) token estimator separating always-on startup catalog cost from deferred body/resource tokens.
- **Bilingual Trigger Conflict Radar**: TF-IDF cosine similarity + explicit trigger-phrase collision detection across both English and Chinese skill descriptions.
- **Interactive Prompt Routing Sandbox**: Test any prompt live, inspect matched trigger spans, verify negative-boundary suppression (`Do NOT use for...` / `不负责...`), and catch ambiguous routing collisions before they happen.
- **14-Rule Spec Linter & Secret Shield (`SD001`–`SD104`)**: Validates `SKILL.md` compliance, flags broken links and missing MCP binaries, and automatically masks hardcoded credentials before rendering or exporting.
- **Visual Workflow DAG Composer**: Built with [`@xyflow/react`](https://reactflow.dev/), allowing you to wire Skills, MCP Servers, and Review Gates into an executable, topologically sorted **Orchestrator `SKILL.md`**.
- **Secret-Safe Cross-Platform Exporter**: Convert curated skills & redacted MCP configs between **Claude Code**, **Cursor (`.mdc`)**, **Gemini CLI**, **Antigravity Plugin**, and **Portable JSON**.

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build core, server, CLI, and Web Control Tower
pnpm build

# 3. Launch the interactive Control Tower with the bundled demo workspace
pnpm demo
# -> Open http://127.0.0.1:4173 (switch to "My Machine (Read-Only)" in the top bar anytime!)
```

### CLI Commands

```bash
# Scan bundled demo workspace or your real local agent directories
node packages/cli/dist/cli.js scan --demo
node packages/cli/dist/cli.js scan --local

# CI-ready spec & security linter (exits non-zero on errors; add --strict to fail on warnings)
node packages/cli/dist/cli.js lint --demo
node packages/cli/dist/cli.js lint --local --json

# Context budget breakdown & bilingual trigger conflict radar
node packages/cli/dist/cli.js budget --demo
node packages/cli/dist/cli.js conflicts --demo

# Simulate prompt-to-skill routing in the terminal
node packages/cli/dist/cli.js route --demo "Deploy a Cloudflare Worker with wrangler.toml"
node packages/cli/dist/cli.js route --demo "帮我拆分镜，生成分镜表和首帧提示词"

# Export a sanitized cross-platform bundle (all detected secrets replaced with ${ENV_VAR})
node packages/cli/dist/cli.js export --demo --target cursor --out .skilldeck-export/cursor
```

---

## Architecture

```text
skill-deck/
├── packages/
│   ├── core/          # @skilldeck/core — Zero-UI engine (scanner, parser, tokens, conflicts, router, linter, redactor, exporter)
│   ├── server/        # @skilldeck/server — Localhost-only Node HTTP API & static Web UI host
│   └── cli/           # @skilldeck/cli — Terminal CLI (`scan`, `lint`, `budget`, `conflicts`, `route`, `export`, `serve`)
├── apps/
│   └── web/           # @skilldeck/web — React 19 + TypeScript + Vite + React Flow Control Tower UI
├── examples/
│   └── demo-workspace/ # Realistic multi-platform English + Chinese fixture workspace
└── docs/
    ├── architecture.md
    └── spec-checks.md
```

See [docs/architecture.md](./docs/architecture.md) and [docs/spec-checks.md](./docs/spec-checks.md) for detailed design notes and the full lint rule catalog.

---

## Privacy & Security

- **100% Local-First**: SkillDeck runs strictly on `127.0.0.1` and makes zero outbound telemetry requests.
- **Read-Only Discovery**: Scanning your machine never modifies existing `.gemini`, `.claude`, `.cursor`, or `.codex` files.
- **Automatic Credential Redaction**: Detected API keys, tokens, and database passwords inside MCP configs are masked inside `@skilldeck/core` before reaching the HTTP API, browser UI, or exported bundles.

## Development & Testing

```bash
pnpm typecheck   # Strict TypeScript checks across all packages & web app
pnpm test        # Run Vitest unit & REST API integration suite
pnpm build       # Production build for all packages + Web UI
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

MIT © 2026 SkillDeck Contributors
