# Contributing to SkillDeck

Thank you for your interest in contributing to **SkillDeck**!

## Development Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

To run the local API server and Vite dev server side-by-side:

```bash
pnpm dev
```

## Architecture Guidelines

- Keep `@skilldeck/core` free of UI, HTTP, or framework dependencies so it remains usable as a standalone Node/TypeScript library.
- Never allow unredacted secrets from MCP configurations to pass through HTTP responses, CLI logs, or export bundles.
- Add unit tests under `packages/core/tests/` or `packages/server/tests/` for every new lint rule, parser feature, or API endpoint.
- Keep `SKILL.md` spec checks aligned with the open [Agent Skills specification](https://agentskills.io) and MCP `mcpServers` JSON schema.

## Pull Request Checklist

1. `pnpm typecheck` passes with zero errors.
2. `pnpm test` passes with all tests green.
3. `pnpm build` completes cleanly across all workspace packages and `apps/web`.
4. New lint rules are documented in `docs/spec-checks.md`.
