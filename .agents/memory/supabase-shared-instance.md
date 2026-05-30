---
name: Supabase shared instance & schema isolation
description: This Supabase DB is shared across many apps; our tables live in a dedicated schema, not public.
---

# Supabase connection

The `SUPABASE_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV` secrets point to a Supabase
**Supavisor pooler** host (`*.pooler.supabase.com`) on port **6543 (transaction mode)**.

## Rule: our app uses a dedicated `sport_center` Postgres schema, never `public`
**Why:** This Supabase project's `public` schema is shared with many other apps and
already contains ~150 tables, including conflicting `users` and `payments` tables and a
`user_role` enum. Writing our tables into `public` collides with them and is unsafe.
**How to apply:** All Drizzle tables/enums are defined via `pgSchema("sport_center")`
(see `lib/db/src/schema/_schema.ts` → `scSchema`). Drizzle auto-qualifies queries as
`"sport_center"."table"`, so runtime needs no `search_path` change. Keep new tables on
`scSchema`, never plain `pgTable`/`pgEnum`.

## Rule: `drizzle-kit push` does NOT work against this DB — generate + apply manually
**Why:** `drizzle-kit push` hangs forever on "Pulling schema from database" because its
introspection scans the entire shared `public` schema (~150 tables). It is not a
connectivity problem — a plain `pg` client connects in ~1s.
**How to apply:** Use `drizzle-kit generate` (offline, no DB connection) to produce SQL,
then apply that SQL with a `pg` client over the **session pooler (port 5432)**, wrapped
in a transaction. Prepend `CREATE SCHEMA IF NOT EXISTS sport_center;`. Migrations/DDL
need port 5432 (session); runtime app traffic uses 6543 (transaction) fine.

## SSL
Pooler connections require SSL. `pg.Pool`/drizzle config sets `ssl: { rejectUnauthorized: false }`
when the URL host matches `supabase.(co|com|in)`.

## Connection selection (`lib/db/src/index.ts`)
- dev: `SUPABASE_DATABASE_URL_DEV` (fallback `DATABASE_URL`)
- prod: `SUPABASE_DATABASE_URL` (fallback `PROD_DATABASE_URL`/`DATABASE_URL`)
