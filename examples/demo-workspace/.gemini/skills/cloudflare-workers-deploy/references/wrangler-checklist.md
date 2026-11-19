# Wrangler Deployment Checklist

- Confirm `compatibility_date` is set to the current quarter.
- Run `wrangler deployments list` before promoting canary traffic.
- Roll back immediately via `wrangler rollback <deployment-id>` if 5xx error rates spike.
