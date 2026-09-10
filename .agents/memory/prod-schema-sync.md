---
name: Prod schema sync approach
description: How to apply Drizzle schema changes to the shared production Supabase DB without drizzle-kit push hanging
---

## Rule
Never use `drizzle-kit push` against the production Supabase DB — it times out indefinitely because the DB has 150+ tables in the public schema and schema introspection takes forever.

**Why:** The shared Supabase instance (nzdweipzckfszczzqtuw) has ~150 tables from other apps in the public schema. drizzle-kit introspects all of them before comparing — it hangs for minutes then times out.

Replit Publish updates the Autoscale deployment but does not synchronize this external Supabase schema.

**Why:** The application can deploy successfully while new Drizzle fields are absent from Supabase, producing PostgreSQL `42703` errors only when a route selects them.

**How to apply:** First run a read-only DEV↔PROD schema audit, then write a targeted Node.js/pg script in `scripts/src/` that:
1. Uses the exact application runtime connection for any function/trigger checked during startup; general DDL may use the session pooler, but must be re-verified through a fresh runtime connection before publishing
2. Uses `information_schema.columns` to check which columns already exist per table
3. Only runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for missing columns
4. Runs the columns only for `sport_center.*` tables by name
5. Delete the script after use

Startup migration guards must use the current official `sport_*` table names.
Legacy names such as `sport_center.payments` can fail non-fatally and leave
production missing a column that a confirmation route writes.

**Why:** The API can start successfully while swallowing a legacy-table
migration warning; the first payment confirmation then exposes the schema gap
as HTTP 500.

**How to apply:** When a table has been renamed, update both the Drizzle schema
and every startup/manual migration statement before publishing. Verify the
target table with a read-only schema query before approving PROD changes.

Production connection source: `SUPABASE_DATABASE_URL`; never log or commit the URL.

Startup-gated function and trigger migrations must load secrets through the same runtime loader as the published API and preserve the configured pooler endpoint.

**Why:** Rewriting the connection or parsing the shared secret independently can update a different catalog view while the published runtime still sees the old function definition, causing a port timeout before `app.listen()`.

**How to apply:** Use the guarded production migration runner, then verify all startup markers again from a new connection created by the application secret loader.

The production startup guard may transactionally self-repair only the canonical resolver and payment-mirror function definitions when their compatibility markers drift, under the provisioning advisory lock; every other invariant remains read-only and fail-closed.

**Why:** Both functions were observed reverting after a successful publish, causing a later cold start to exit before opening its port even though the prior deployment had passed.

**How to apply:** Check markers under the advisory lock, replace only the drifted functions, then run the complete invariant query before binding the server port. Investigate and remove the external writer separately.
