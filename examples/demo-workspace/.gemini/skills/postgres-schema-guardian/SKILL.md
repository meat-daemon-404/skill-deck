---
name: postgres-schema-guardian
description: Design and audit PostgreSQL and Supabase database schemas, Row-Level Security (RLS) policies, indexes, and zero-downtime migrations. Use when altering tables, writing SQL migrations, or debugging slow EXPLAIN plans. Do NOT use for frontend CSS or browser UI styling.
license: MIT
metadata:
  author: data-infra
  version: "1.3.0"
---

# PostgreSQL Schema Guardian

Apply defensive database engineering before executing any DDL statement.

## Rules

1. Always enable Row-Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on tenant-scoped tables.
2. Add indexes concurrently (`CREATE INDEX CONCURRENTLY`) on tables larger than 100k rows.
3. Verify policy isolation using [verify-rls.sql](./scripts/verify-rls.sql).
