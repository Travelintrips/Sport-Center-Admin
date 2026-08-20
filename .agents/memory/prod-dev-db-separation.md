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

## Cross-environment schema audits

The development workflow only receives development-scope variables. A read-only
DEV-versus-PROD schema audit therefore cannot connect to both databases from the
normal DEV shell unless a separate production-scoped runner is used. Do not
copy the production connection URL into the development scope just to run an
audit; that weakens the isolation boundary.

## Dev Supabase project credentials are dead — both scopes point at prod DB
The dev Supabase project (ref `xssrf...`) DB password in `SUPABASE_DATABASE_URL_DEV`
is invalid (auth fails → Supabase PgBouncer trips `(ECIRCUITBREAKER) too many
authentication failures`, self-resets after ~30s revealing the real `password
authentication failed`). User repeatedly declined to provide the correct dev
password. Only the prod DB (ref `nzdw...`) has a working password. Resolution:
point `SUPABASE_DATABASE_URL_DEV` (dev scope) AND `SUPABASE_DATABASE_URL` +
`SUPABASE_PG_URL` (prod scope) all at the prod DB connection string so login works
in both. Trade-off: dev now writes to the prod DB (no isolated dev DB available).
**Why:** without the dev project password there is no other reachable DB.
**Gotcha:** these env changes have been observed to REVERT after republish/rollback
from an older checkpoint — re-applying via `setEnvVars` and confirming `.replit`
reflects the value is required; tell the user not to roll back to a pre-fix
checkpoint.

## How to prove which DB the live site uses
Compare a row-count fingerprint of each DB (connect with `pg` via
`createRequire('/home/runner/workspace/scripts/package.json')` inside code
execution) against what the live API returns. The cleanest signal: log in to the
production API as admin and `GET /api/bookings` — the count matches exactly one DB.

## Current enforcement

Development runtime and migrations require `SUPABASE_DATABASE_URL_DEV`;
production runtime and migrations require `SUPABASE_DATABASE_URL`. The old
`DATABASE_URL` fallback and `ALLOW_DEV_ON_PROD_DB` override are not valid for
the application path. Auxiliary accounting, health, payment-enrichment, and
BizPortal pools follow the same environment selection.

**Why:** A fallback in a helper can silently bypass the primary database
boundary even when the main startup log shows the correct database.

**How to apply:** Keep all new direct PostgreSQL pools environment-selected in
the same way as the primary DB module, and re-publish after production
configuration changes so the deployment receives production-scoped values.
