# Changelog

All notable changes to **SkillDeck** (`meat-daemon-404/skill-deck`) are documented in this file.

## [0.3.0] - 2026-11-19

### Added
- **Multi-Turn SuperAgent Tool-Calling Engine (`packages/core/src/superagent-loop.ts`)**: Native OpenAI-compatible API (`/v1/chat/completions`) and local Ollama (`/api/chat`) multi-turn autonomous tool execution loop with real-time step telemetry and interactive `SuperAgentView.tsx` console.
- **PII & Workspace Path Sanitization (`packages/core/src/secrets.ts`)**: Automatic scrubbing of local home directories, Windows drive paths, and credential tokens across audit logs and outbound prompts.
- **Native `agent-immune` v3.0 Dual-Layer Shield Compatibility**: Designed to pair seamlessly with `dsh-immune-system` (`v3.0.0`) Pre-Flight Blast-Radius Guard (`immune guard`), Workspace DNA Vaccine Lockfiles (`immune vaccinate`), and Swarm Federation (`immune federate`).

## [0.2.0] - 2026-11-19

### Added
- **Transactional Skill Vault & Hub Registry (`packages/hub`, `packages/core`)**: Atomic install/rollback of agent `SKILL.md` bundles with SHA-256 integrity checks.
- **MCP Aggregation Gateway (`packages/server`)**: Unified local control tower multiplexing multiple Model Context Protocol (MCP) servers with audit logging (`AuditMcpView.tsx`).

## [0.1.0] - 2026-11-19

### Added
- Initial monorepo architecture (`apps/web`, `packages/core`, `packages/server`, `packages/cli`, `packages/hub`) with bilingual ZH/EN UI and Vitest test suite.
