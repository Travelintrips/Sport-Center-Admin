---
name: Replit DB migration fix
description: The DB client had a hard lock requiring Supabase URLs. Removed it to allow Replit's built-in PostgreSQL (DATABASE_URL pointing to helium).
---

# DB Client Supabase Lock Removal

The original `lib/db/src/index.ts` had a hard "AI KERNEL v2" guard that rejected any non-Supabase connection string with a fatal error. This prevented Replit's built-in PostgreSQL (`DATABASE_URL=postgresql://...@helium/heliumdb`) from being used.

**Fix:** Rewrote the DB resolution logic to accept `DATABASE_URL` (Replit PG) as a valid fallback in both dev and production, while still preferring Supabase URLs when present.

**Why:** Replit provides its own PostgreSQL via `DATABASE_URL` / `PGHOST=helium`. The Supabase-only guard was an AI-generated safety measure that made sense for the original environment but breaks Replit compatibility.

**How to apply:** If the DB guard ever returns, check `lib/db/src/index.ts` for the `/supabase\.(co|com|in)/.test(connectionString)` check and remove or adapt it.

Also updated `artifacts/api-server/src/index.ts` production env validation — `SUPABASE_DATABASE_URL` is no longer fatal in prod if `DATABASE_URL` is available. `SUPABASE_SERVICE_ROLE_KEY` downgraded from fatal to warn (Replit Object Storage is the primary storage).
