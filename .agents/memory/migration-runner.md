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
