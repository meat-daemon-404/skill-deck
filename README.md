# SkillDeck v0.2

**Local-first SuperAgent Control Tower, MCP Aggregation Gateway, Dual-Layer Agent-Immune Shield (natively integrated with [`meat-daemon-404/agent-immune`](https://github.com/meat-daemon-404/agent-immune)), and Transactional Skill Vault — with full Bilingual UI (简体中文 / English).**

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-0284c7.svg)](./LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/Node.js-%3E%3D20-047857.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6.svg)](https://www.typescriptlang.org)
[![agent-immune native](https://img.shields.io/badge/agent--immune-SQLite%20%2B%20JSONL%20Native-10b981.svg)](https://github.com/meat-daemon-404/agent-immune)

---

## What's New in v0.2

1. **SuperAgent Command Center & Live DAG Runner** — Auto-detects local CLI agents (`agy` Antigravity CLI, `ollama` + live local models, `claude`, `gemini`, `codex`, `gh`), routes across all 7 Agent platforms (`Antigravity`, `Claude Code`, `Cursor`, `Gemini CLI`, `Codex`, `DSH`, `ZCode`), injects `<immune_memory>` pitfall antibodies, and runs visual React Flow DAGs step-by-step with live per-node status telemetry.
2. **Native [`meat-daemon-404/agent-immune`](https://github.com/meat-daemon-404/agent-immune) Integration (Dual-Layer Immunity)**:
   - **Layer 1 — Self-Evolving Pitfall Memory (`trigger → avoid → do`)**: Zero-dependency `node:sqlite` read-only bridge for `~/.dsh/immune.sqlite`, `~/.zcode/immune.sqlite`, `~/.agent-immune/immune.sqlite`, and Git-native `.immune/rules.jsonl` team sync, with delimiter-isolated `<immune_memory>` injection and live pitfall distillation.
   - **Layer 2 — ToxicSkills Security Shield & Runtime Firewall**: Scans every `SKILL.md` and `scripts/` for prompt injection (`IMM001`), credential exfiltration (`IMM002`), destructive pipes (`IMM003`), covert tool poisoning (`IMM004`), and Unicode smuggling (`IMM005`); enforces a runaway loop circuit breaker and Human-in-the-Loop Quarantine Queue (`Approve` / `Reject` / `Immunize`).
3. **`@skilldeck/hub` — Real Local MCP Aggregation Gateway (`skilldeck hub`)** — A genuine stdio JSON-RPC 2.0 MCP Meta-Server exposing 7 progressive-disclosure meta-tools (`~580` tokens vs. `20,000+` direct tokens), downstream MCP `tools/list` probes, and a real-time SSE telemetry stream.
4. **Skill Vault & Transactional Sync** — Single-source-of-truth Vault (`~/.skilldeck/vault/`), Dry-Run Sync preview, safe skill Quarantine/Disable, and 1-click Transaction Rollback.
5. **Bilingual Web UI (简体中文 Default + 1-Click EN Switch)** — Full Chinese & English interface with modern light/dark mode.

---

## Quick Start

```bash
pnpm install
pnpm build
pnpm demo
# Open http://127.0.0.1:4173 — switch to "扫描本机（只读） / My Machine" anytime!
```

### Connect Every Agent to `@skilldeck/hub` (1 Entry, ~95% Startup Token Savings)

```json
{
  "mcpServers": {
    "skilldeck-hub": {
      "command": "node",
      "args": ["<path-to-skill-deck>/packages/cli/dist/cli.js", "hub", "--local"]
    }
  }
}
```

### CLI Commands

```bash
node packages/cli/dist/cli.js scan --local       # Scan Antigravity, Claude, Cursor, Codex, DSH & ZCode
node packages/cli/dist/cli.js immune --demo      # Dual-layer ToxicSkills + agent-immune pitfall report
node packages/cli/dist/cli.js agents             # Detect local CLI agents & running Ollama models
node packages/cli/dist/cli.js run --demo "Deploy Cloudflare Worker with wrangler.toml"
node packages/cli/dist/cli.js hub --local        # Start real stdio JSON-RPC 2.0 MCP Meta-Server
node packages/cli/dist/cli.js serve --demo       # Launch bilingual Web Control Tower
```

---

## Architecture

```text
skill-deck/
├── packages/
│   ├── core/          # @skilldeck/core — Scanner (7 platforms), agent-immune SQLite/JSONL bridge, ToxicSkills shield, Vault & Rollback, SuperAgent planner & DAG runner
│   ├── hub/           # @skilldeck/hub — Real stdio MCP Meta-Server, downstream JSON-RPC client, runtime firewall & SSE traces
│   ├── server/        # @skilldeck/server — Localhost-only HTTP/SSE API & static Web UI host
│   └── cli/           # @skilldeck/cli — `scan`, `lint`, `immune`, `budget`, `conflicts`, `route`, `agents`, `run`, `hub`, `export`, `serve`
├── apps/
│   └── web/           # @skilldeck/web — Bilingual (ZH/EN) React 19 + React Flow Control Tower UI
└── examples/
    └── demo-workspace/ # Realistic demo with EN/ZH skills, .immune/rules.jsonl, toxic demo skill & MCP configs
```

## License

MIT © 2026 SkillDeck Contributors
