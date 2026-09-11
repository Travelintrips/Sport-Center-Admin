---
name: API bundle schema rebuild
description: Shared database schema changes can remain absent from the running API bundle until the API workflow is rebuilt.
---

When a shared `@workspace/db` schema changes, rebuild/restart the API workflow before diagnosing runtime behavior; the running bundle can otherwise use the previous table definition and silently omit newly added response fields.

**Why:** The development API had a stale bundled `users` schema, so PPh fields existed in source but were absent from customer responses until the workflow rebuilt.

**How to apply:** After schema or shared-library changes, restart the managed API workflow and verify the affected endpoint response before changing application logic.