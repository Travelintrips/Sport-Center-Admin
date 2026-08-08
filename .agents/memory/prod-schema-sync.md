---
name: Prod schema sync approach
description: How to apply Drizzle schema changes to the shared production Supabase DB without drizzle-kit push hanging
---

## Rule
Never use `drizzle-kit push` against the production Supabase DB — it times out indefinitely because the DB has 150+ tables in the public schema and schema introspection takes forever.

**Why:** The shared Supabase instance (nzdweipzckfszczzqtuw) has ~150 tables from other apps in the public schema. drizzle-kit introspects all of them before comparing — it hangs for minutes then times out.

**How to apply:** Write a targeted Node.js/pg script in `scripts/src/` that:
1. Connects via session pooler (port 5432, not 6543)
2. Uses `information_schema.columns` to check which columns already exist per table
3. Only runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for missing columns
4. Runs the columns only for `sport_center.*` tables by name
5. Delete the script after use

Environment variable: `PROD_DB_URL` with the full connection string (set temporarily via CLI, never committed).
