---
name: Local DB setup & env var scoping
description: Workflow uses local heliumdb (DATABASE_URL), not Supabase; drizzle-kit push fails on enum conflicts; correct migration approach for local PG.
---

## The Rule
The development API now uses the development-scoped `SUPABASE_DATABASE_URL` secret when it is present; otherwise it falls back to `DATABASE_URL` (Replit's local heliumdb). Shell/bash commands may not expose the secret even when the workflow does.

**Why:** Replit environment scopes and workflow secret injection can differ from shell subprocess environments. The runtime selection is defined in `lib/db/src/index.ts`, so verify the running API rather than assuming the shell's variables reflect the workflow.

**How to apply:** Keep Supabase runtime traffic on the pooler connection, and apply schema changes with a direct `pg` client using the session pooler (port 5432). If development intentionally uses local PG, apply local migrations manually — do NOT rely on `drizzle-kit push`.

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
