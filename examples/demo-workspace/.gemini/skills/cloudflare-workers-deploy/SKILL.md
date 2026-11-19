---
name: cloudflare-workers-deploy
description: Build, configure, and deploy Cloudflare Workers applications with Wrangler, KV, D1, R2 bindings, and Durable Objects. Use when the user asks to deploy a Worker, edit wrangler.toml, or troubleshoot edge routing. Do NOT use for Docker containers or Kubernetes clusters.
license: MIT
compatibility: Requires Node.js 20+ and wrangler CLI.
metadata:
  author: platform-team
  version: "2.1.0"
---

# Cloudflare Workers Deployment

Follow this concise checklist before deploying any edge service.

## Pre-Flight Steps

1. Validate `wrangler.toml` bindings (`KV`, `D1`, `R2`) against staging and production environments.
2. Run typechecks and local preview with `wrangler dev`.
3. Verify secrets are injected via `wrangler secret put` and never committed to source control.

## Deep References

- See [Wrangler Checklist](./references/wrangler-checklist.md) for binding templates and rollback commands.
