---
name: Local DB setup & env var scoping
description: Workflow uses local heliumdb (DATABASE_URL), not Supabase; drizzle-kit push fails on enum conflicts; correct migration approach for local PG.
---

## The Rule
The API server workflow does NOT have access to `SUPABASE_DATABASE_URL_DEV` or `SUPABASE_DATABASE_URL` from `.replit` userenv.shared — it always falls back to `DATABASE_URL` (Replit's local heliumdb). Shell/bash commands also cannot read those env vars.

**Why:** Replit's userenv.shared variables from `.replit` are only available to workflows via the Replit UI secrets system, NOT exported to shell or sub-processes in the same way. In practice, the Node.js process started by the workflow only receives `DATABASE_URL` from Replit's built-in DB provisioning.

**How to apply:** When the local PG is empty/missing tables, apply migrations manually — do NOT rely on drizzle-kit push.

## Correct local PG migration approach

1. If enum types exist but tables don't (push will fail with "type X already exists"):
   ```
   DROP SCHEMA IF EXISTS sport_center CASCADE;
   CREATE SCHEMA sport_center;
   -- Note: this drops enums only if they're in sport_center schema
   -- If enums are in public schema, also run: DROP TYPE IF EXISTS user_role CASCADE; etc.
   ```

2. Apply all migration files in order:
   ```js
   const files = ['lib/db/drizzle/0000_*.sql', '0001_*.sql', '0002_*.sql', ...];
   // split each file on "--> statement-breakpoint" and execute each statement
   // catch 42710 (type exists), 42P07 (table exists), 42701 (column exists) and skip
   ```

3. Seed demo data:
   ```bash
   cd scripts && node_modules/.bin/tsx src/seed-all.ts
   ```

## drizzle.config.ts vs lib/db/src/index.ts priority difference
- `drizzle.config.ts`: `DATABASE_URL` first, then Supabase URLs — used by drizzle-kit CLI
- `lib/db/src/index.ts`: `SUPABASE_DATABASE_URL_DEV` first, then `DATABASE_URL` — used by API runtime

In practice both resolve to `DATABASE_URL` in the dev workflow since Supabase vars aren't available.

## Reading Supabase URLs from shell
To run SQL against Supabase from a shell script, parse the URL from the `.replit` file:
```js
const content = fs.readFileSync('.replit', 'utf8');
const match = content.match(/SUPABASE_DATABASE_URL_DEV\s*=\s*"([^"]+)"/);
const url = match[1].replace('pooler.supabase.com:6543', 'pooler.supabase.com:5432');
```
Use port 5432 (session pooler) for DDL; port 6543 (transaction pooler) is for runtime queries.
