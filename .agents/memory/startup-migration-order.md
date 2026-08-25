---
name: Development startup migration order
description: Development schema migrations must complete before scheduler queries begin.
---

Development startup migrations run asynchronously after the server binds its port. Any newly added columns or tables can therefore be missing when the scheduler performs its first query.

**Why:** Starting the scheduler immediately caused it to query the expanded Drizzle booking projection before the idempotent development migration had added the new columns.

**How to apply:** Keep production startup migration-free, but in development start the scheduler only after schema migration and seed completion. Treat an early scheduler query error as a startup ordering issue before changing business logic.