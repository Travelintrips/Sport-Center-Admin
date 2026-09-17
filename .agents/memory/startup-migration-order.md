---
name: Development startup migration order
description: Development schema migrations must complete before scheduler queries begin.
---

Development startup migrations run asynchronously after the server binds its port. Any newly added columns or tables can therefore be missing when the scheduler performs its first query.

**Why:** Starting the scheduler immediately caused it to query the expanded Drizzle booking projection before the idempotent development migration had added the new columns.

**How to apply:** Keep production startup migration-free, but in development start the scheduler only after schema migration and seed completion. Treat an early scheduler query error as a startup ordering issue before changing business logic.

The root `/readiness` endpoint is intentionally exempt from the application startup gate, so it can return HTTP 200 while feature routes still return `STARTUP_MIGRATIONS_PENDING`. Use a gated application route such as `/api/settings`, or wait for the migration-complete log, before feature smoke tests.

**Why:** A Mina smoke test started immediately after workflow restart can otherwise measure startup timing instead of Mina/provider behavior.

**How to apply:** Distinguish health-probe readiness from application readiness when validating development workflows; do not diagnose an early feature-route 503 as an AI or database regression until the gated route is available.