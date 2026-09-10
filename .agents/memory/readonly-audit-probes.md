---
name: Read-only audit probes
description: Safe patterns for discovery scripts that inspect optional PostgreSQL schema objects.
---

Optional schema discovery queries can legitimately fail because a table or column is absent. In a PostgreSQL transaction, catching that error is not enough: the transaction is aborted until it rolls back to a savepoint. A single client also must not run savepoint-backed probes concurrently.

**Why:** The CF-SC-7C discovery initially aborted on an optional object and then hit a missing-savepoint error when matrix probes ran in parallel on one client.

**How to apply:** Wrap each optional query in its own savepoint and rollback/release on failure; serialize those calls when they share one `pg.Client`, or use separate clients.