---
name: Prod/dev DB separation & deployment snapshots
description: Why production showed dev data despite correct env scoping, and how it was proven.
---

# Prod vs dev database separation

`lib/db/src/index.ts` picks the connection string by precedence:
`SUPABASE_DATABASE_URL || PROD_DATABASE_URL || DATABASE_URL || SUPABASE_DATABASE_URL_DEV`.

Env var scopes (Replit) hold separate Supabase DBs:
- `development` scope `SUPABASE_DATABASE_URL` → dev project (ref `xssrf...`)
- `production` scope `SUPABASE_DATABASE_URL` → prod project (ref `nzdw...`)

Both projects share the **same seed** (identical 6 facility names), so facility
names cannot distinguish them. Distinguish by **row counts** instead
(e.g. bookings/users) or by querying the live API after admin login.

## The bug: production served dev data
Even with the production-scope DB URL set correctly, the **live deployment kept
serving dev data**. Root cause: **Replit deployments bake env/secrets at publish
time**. The production DB URL was added *after* the last publish, so the running
deployment still carried the old value (the dev URL).

**Fix:** re-publish so the deployment picks up the current production-scoped
`SUPABASE_DATABASE_URL`.

**Why this matters:** changing a production-scoped secret has NO effect on a
running deployment until you redeploy. Always re-publish after changing prod env.

## How to prove which DB the live site uses
Compare a row-count fingerprint of each DB (connect with `pg` via
`createRequire('/home/runner/workspace/scripts/package.json')` inside code
execution) against what the live API returns. The cleanest signal: log in to the
production API as admin and `GET /api/bookings` — the count matches exactly one DB.
