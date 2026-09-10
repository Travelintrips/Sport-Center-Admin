---
name: Migration runner setup
description: How to run DB migrations in this monorepo — tsx path and pg dependency requirements
---

The root `scripts/migrate.ts` file uses `pg` directly. To run it:

1. `pg` must be in `scripts/package.json` dependencies (not just in lib/db)
2. Use `scripts/node_modules/.bin/tsx scripts/migrate.ts` (not `npx tsx` or `pnpm tsx`)
3. The migration connects via session pooler (port 5432), swapping 6543→5432 in the URL

**Why:** `drizzle-kit push` hangs on Supabase shared instance introspection of ~150 public tables. Direct pg client on port 5432 (session pooler) is the only reliable migration path.

**How to apply:** Any schema changes → add SQL to scripts/migrate.ts → run above command. Always use `CREATE TABLE IF NOT EXISTS` and `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for idempotency.

## Existing-table compatibility

`CREATE TABLE IF NOT EXISTS` does not repair tables that already exist with an older shape. Every production-critical column used by a route must also have an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` path, or an older production database can return HTTP 500 even though startup reports migrations complete.

**Why:** Legacy production tables may predate later schema additions; table creation guards silently skip them.

**How to apply:** For each newly required column, add both the canonical migration and a safe compatibility migration for pre-existing tables, then verify the column in the target environment before testing the route.
