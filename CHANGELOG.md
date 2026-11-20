# Changelog

All notable changes to **SkillDeck** (`@skilldeck/*`) are documented in this file.

## [0.4.0] - 2026-11-20

### Added
- **7-Platform `agent-immune v3.0.0` SQLite Discovery (`agent-immune-bridge.ts`)**: Expanded `getDefaultAgentImmuneStores()` to automatically discover `~/.claude/immune.sqlite`, `~/.cursor/immune.sqlite`, and `~/.codex/immune.sqlite` alongside `~/.dsh`, `~/.zcode`, and `~/.agent-immune`.
- **DNA Vaccine Lockfile (`.immune/vaccine.lock.json`) Engine**: Added `compileVaccineLockfile()`, `verifyVaccineLockfile()`, and `readAntibodiesFromVaccineLock()` with canonical SHA-256 content digest verification.
- **Pre-Flight Tool Risk Guard (`preflightCheckToolCall`)**: Scores blast radius (`0–100`, `safe` / `caution` / `quarantine`), provides deterministic safe command rewrites (such as `git push --force` -> `git push --force-with-lease`), and recalls matching `<immune_memory>` pitfall antibodies before execution.

## [0.3.0] - 2026-11-19

### Added
- **Universal Platform Parity**: Added first-class scanning and export support for Cursor (`~/.cursor/skills`, `~/.cursor/mcp.json`) and Windsurf (`~/.codeium/windsurf/skills`, `~/.codeium/windsurf/mcp_config.json`) across all 7 major agent platforms.
- **Zero-Token Lazy MCP Gateway (`@skilldeck/hub`)**: Added `hub_search_tools` (bilingual keyword discovery) and `hub_describe_tool` (on-demand JSON Schema lookup).

## [0.2.1] - 2026-04-20

### Fixed
- Fixed Windows & custom scan-root classification, CJK Jaccard routing threshold, and `--json` export output purity.
