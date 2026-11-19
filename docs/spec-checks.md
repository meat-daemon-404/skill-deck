# SkillDeck Lint & Security Rules Reference

SkillDeck audits Agent Skills (`SKILL.md` / `.mdc`) and MCP configurations (`mcpServers`) against 14 deterministic rules.

## Agent Skills Specification & Hygiene (`SD001`–`SD010`)

| Rule ID | Severity | Category | Description |
| :--- | :--- | :--- | :--- |
| `SD001` | Error | `spec` | Missing or syntactically invalid YAML frontmatter block (`---`). |
| `SD002` | Error | `spec` | Missing required `name` field in `SKILL.md` frontmatter. |
| `SD003` | Warning | `spec` | `name` violates the Agent Skills naming pattern (`^[a-z0-9]+(-[a-z0-9]+)*$`, 1–64 chars). |
| `SD004` | Warning | `spec` | Frontmatter `name` does not match its parent directory name. |
| `SD005` | Error | `spec` | Missing required `description` field needed for startup discovery. |
| `SD006` | Warning / Info | `budget` | `description` exceeds the 1,024-char spec cap or consumes excessive always-on startup tokens. |
| `SD007` | Info | `hygiene` | `description` lacks clear activation triggers (`Use when...`, `Trigger on...`, `触发词：...`). |
| `SD008` | Warning | `budget` | `SKILL.md` body exceeds progressive-disclosure limits (>450 lines or >3,800 tokens); offload details to `references/`. |
| `SD009` | Error | `hygiene` | Relative Markdown link inside `SKILL.md` points to a nonexistent local file. |
| `SD010` | Warning | `hygiene` | Duplicate skill `name` discovered across multiple scanned directories or platforms. |

## MCP Security & Reliability (`SD101`–`SD104`)

| Rule ID | Severity | Category | Description |
| :--- | :--- | :--- | :--- |
| `SD101` | Error | `security` | Hardcoded plaintext credential or API key detected in MCP `env`, `headers`, or `args`. |
| `SD102` | Warning | `mcp` | Duplicate MCP server name declared across multiple configuration files. |
| `SD103` | Warning | `mcp` | Configured `stdio` MCP executable was not found on the local system `PATH`. |
| `SD104` | Info | `security` | Unpinned `@latest` package executed via `npx`/`pnpx`/`uvx` on startup. |

## Health Score Formula

Starting from `100`, SkillDeck computes a size-normalized penalty scaled by `sqrt(max(1, (skills + mcpServers) / 14))` so both small workspaces and 200+ skill power-user environments get an actionable `0–100` gradient:
- `10` raw points per `error` (plus `+6` unscaled penalty per hardcoded-secret security error)
- `3.5` raw points per `warning`
- `0.75` raw points per `info`
- `5` raw points per `high`-severity trigger conflict pair

Final score is `clamp(100 - round(normalizedPenalty), 0, 100)`.
