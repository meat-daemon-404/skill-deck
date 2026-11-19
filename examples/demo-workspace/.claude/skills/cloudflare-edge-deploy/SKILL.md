---
name: cloudflare-edge-deploy
description: "Deploy Cloudflare Workers and Pages applications using Wrangler CLI, configure KV and R2 bindings, and troubleshoot edge routing errors. Trigger on: 'deploy a Worker', 'wrangler.toml', 'Cloudflare Workers', 'edge routing'."
license: MIT
---

# Cloudflare Edge Deploy Helper

Use this workflow to push edge workers quickly.

## Steps

1. Inspect `wrangler.toml` or `wrangler.jsonc`.
2. Execute `npx wrangler deploy --dry-run`.
3. Publish to production and tail live logs via `npx wrangler tail`.
