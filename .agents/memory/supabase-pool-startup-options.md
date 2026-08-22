---
name: Supabase pool startup options
description: Supavisor compatibility constraint for PostgreSQL pool connection options.
---

Supabase/Supavisor connections must not receive PostgreSQL `search_path` through the `pg` pool `options` startup parameter. Use explicit schema-qualified SQL instead.

**Why:** Supavisor rejects that startup parameter with `unsupported startup parameter in options: search_path`, which can make an otherwise valid production API fail its startup health check.

**How to apply:** When creating pools for Supabase, keep connection options limited to supported settings such as SSL and pool sizing; qualify tables/functions with their schema in queries.