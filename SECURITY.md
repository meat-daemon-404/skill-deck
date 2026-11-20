# Security Policy & Local-First Trust Architecture

## 1. Local-First Execution Invariants

**SkillDeck** is engineered as a local-first SuperAgent Control Tower and MCP Aggregation Gateway:

1. **Loopback-Only Binding (`127.0.0.1`)**: The local API server (`packages/server`) binds strictly to `127.0.0.1` by default and never exposes unauthenticated MCP tool endpoints to public network interfaces.
2. **PII & Credential Redaction (`packages/core/src/secrets.ts`)**: Outbound tool traces, prompt logs, and audit views automatically scrub bearer tokens, API keys (`sk-*`, `ghp_*`, `AKIA*`), and machine-specific user paths (`/Users/<user>`, `C:\Users\<user>`).
3. **Dual-Layer Shield with `agent-immune` (`dsh-immune-system` v3.0+)**:
   - **Pre-Flight Blast-Radius Guard**: Destructive shell/SQL/Git commands are scored (`0–100`) and intercepted or rewritten (`--force` -> `--force-with-lease`) before execution.
   - **Transactional Skill Vault**: Skill bundles are hashed and validated inside a staging directory before atomic promotion.

## 2. Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.3.x` | ✅ Active support |
| `< 0.3.0` | ❌ Upgrade to `>= 0.3.0` |

## 3. Reporting a Vulnerability

If you discover a security issue in SkillDeck's MCP gateway, SuperAgent tool loop, or Skill Vault path handling, please open a private security advisory on GitHub at:
`https://github.com/meat-daemon-404/skill-deck/security/advisories/new`
