# SkillDeck Architecture

SkillDeck is organized as a cleanly layered TypeScript monorepo so every capability works equally well from the CLI, CI pipelines, programmatic SDK, and interactive Web Control Tower.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          Presentation Layer                             │
│   apps/web (React 19 + React Flow)      packages/cli (skilldeck CLI)    │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │ HTTP (127.0.0.1)                │ Direct ESM Import
                    ▼                                 │
┌───────────────────────────────────────┐             │
│           packages/server             │             │
│  Node HTTP REST API + Static UI Host  │             │
└───────────────────┬───────────────────┘             │
                    │                                 │
                    ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            packages/core                                │
│  scanner ──► frontmatter ──► tokens ──► conflicts ──► router            │
│     │                                      │                            │
│     └──► secrets (redaction boundary) ──► linter ──► exporter / DAG     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Module Boundaries

### `@skilldeck/core`
- **`scanner.ts`**: Read-only filesystem discovery across Antigravity, Claude Code, Cursor, Gemini CLI, OpenAI Codex, and arbitrary folders. Performs `PATH` availability verification for `stdio` MCP executables without spawning processes.
- **`frontmatter.ts`**: YAML frontmatter parser (`yaml`), Markdown relative link extractor (code-block safe), and bilingual trigger/negative-boundary cue extractor.
- **`secrets.ts`**: Security redaction boundary. Masks known key patterns (OpenAI, Anthropic, Google, GitHub, AWS, Slack, Stripe, JWT, DB credentials) and literal values under sensitive env keys while preserving safe `${ENV_VAR}` references.
- **`tokens.ts`**: Calibrated English + CJK token estimator distinguishing always-on startup prompt tokens from deferred body and bundled resource tokens.
- **`conflicts.ts`**: Bilingual tokenizer (English light stemming + Han bigrams/trigrams) driving TF-IDF cosine similarity and exact trigger phrase collision detection.
- **`router.ts`**: Progressive-disclosure prompt routing simulator incorporating direct name hits, trigger phrases, IDF-weighted overlap, negative-trigger suppression, and ambiguity scoring.
- **`linter.ts`**: 14 deterministic rules (`SD001`–`SD104`) producing structured diagnostics and a transparent `0–100` Workspace Health Score.
- **`exporter.ts`**: Secret-safe cross-platform converter (`claude-code`, `cursor`, `gemini-cli`, `antigravity`, `portable-json`) plus Kahn's topological sort compiler transforming visual DAG workflows into an Orchestrator `SKILL.md`.

### `@skilldeck/server`
- Lightweight zero-dependency Node `http` server bound to `127.0.0.1`.
- Restricts CORS to local dev origins and enforces strict path-traversal containment when serving `apps/web/dist`.

### `apps/web`
- Accessible React 19 SPA using modern CSS cascade layers (`@layer`), `color-scheme: light dark` + `light-dark()`, native `<dialog closedby="any">`, `@container`-responsive sticky-header tables, and `@xyflow/react` for visual DAG composition.
