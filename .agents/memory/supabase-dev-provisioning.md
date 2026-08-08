---
name: Supabase development provisioning
description: Development uses an isolated Supabase project with its own database, Storage credentials, and Realtime credentials.
---

Development must use the dedicated Supabase development credentials and database schema, never a production fallback. Keep the production override disabled once development credentials are configured.

**Why:** Development writes, uploads, and test data must not affect production. Legacy Supabase schemas may contain prefixed tables, so provisioning must also verify that the current application tables and relations exist before testing.

**How to apply:** Verify the four `_DEV` secrets exist, confirm API startup reports the isolated development DB, confirm Storage buckets are reachable, and test representative read endpoints after any environment change.