---
name: Local DB setup & env var scoping
description: Dev workflow uses Helium DATABASE_URL (not Supabase); SUPABASE_DATABASE_URL in dev env vars causes auth failure circuit-breaker; correct migration approach when Helium DB is empty.
---

## The Rule

The development API now uses the development-scoped `SUPABASE_DATABASE_URL` secret when it is present; otherwise it falls back to `DATABASE_URL` (Replit's local heliumdb). Shell/bash commands may not expose the secret even when the workflow does.

**Why:** Replit environment scopes and workflow secret injection can differ from shell subprocess environments. The runtime selection is defined in `lib/db/src/index.ts`, so verify the running API rather than assuming the shell's variables reflect the workflow.

**How to apply:** Keep Supabase runtime traffic on the pooler connection, and apply schema changes with a direct `pg` client using the session pooler (port 5432). If development intentionally uses local PG, apply local migrations manually — do NOT rely on `drizzle-kit push`.

The API server workflow should use `DATABASE_URL` (Replit Helium DB) in development. If `SUPABASE_DATABASE_URL` is set as a Replit **env var** (development scope), it takes priority in `lib/db/src/index.ts` and will fail if credentials are wrong → pg-pool circuit-breaker trips → ALL DB queries fail → WA bot breaks.

**Why:** `lib/db/src/index.ts` priority: `SUPABASE_DATABASE_URL || PROD_DATABASE_URL || DATABASE_URL || SUPABASE_DATABASE_URL_DEV`. If SUPABASE_DATABASE_URL is set in Replit development env vars with expired/wrong credentials, circuit-breaker message is: `(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked`.

**How to apply:**
1. Check Replit dev env vars with `viewEnvVars({ type: "env", environment: "development" })`
2. If `SUPABASE_DATABASE_URL` is present in dev env: `deleteEnvVars({ keys: ["SUPABASE_DATABASE_URL"], environment: "development" })`
3. Restart API server — it will now use `DATABASE_URL` (Helium)


## When Helium DB is empty (no sport_center schema)

1. Create schema: `node -e "require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg').Pool...CREATE SCHEMA IF NOT EXISTS sport_center"`

2. Apply migration files in order (split on "--> statement-breakpoint", skip "already exists" errors):
   - `lib/db/drizzle/0000_fearless_adam_warlock.sql`
   - `lib/db/drizzle/0001_huge_plazm.sql`
   - `lib/db/drizzle/0002_init.sql`
   - `lib/db/drizzle/add_tax_effective_date.sql`

3. Run `drizzle-kit push` (will pick up remaining columns): `pnpm --filter @workspace/db exec drizzle-kit push --config=drizzle.config.ts`

4. Add columns that migrations missed (add more as Drizzle schema evolves):
   - `ALTER TABLE sport_center.settings ADD COLUMN IF NOT EXISTS fonnte_token text`
   - `ALTER TABLE sport_center.settings ADD COLUMN IF NOT EXISTS fonnte_admin_wa text`
   - `ALTER TABLE sport_center.settings ADD COLUMN IF NOT EXISTS admin_wa_phones text`
   - `ALTER TABLE sport_center.settings ADD COLUMN IF NOT EXISTS app_url text`
   - `ALTER TABLE sport_center.facilities ADD COLUMN IF NOT EXISTS image_url text`
   - `ALTER TABLE sport_center.bookings ADD COLUMN IF NOT EXISTS payment_reminder_sent_at timestamptz`
   - `ALTER TABLE sport_center.bookings ADD COLUMN IF NOT EXISTS payer_type text`
   - `ALTER TABLE sport_center.bookings ADD COLUMN IF NOT EXISTS company_customer_id int`

5. Seed demo data (using Helium pg directly):
   - Admin user with HMAC-SHA256(SESSION_SECRET, 'admin123') hash
   - 1 settings row
   - 6 facilities
   - Notification templates (columns: key, name, channel, body, is_active)
   - Promo (columns: title, description, type, discount_percent, start_date, end_date, is_active)

## pg module path for Node.js scripts
`require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg')` — NOT plain `require('pg')` from workspace root.

## drizzle.config.ts vs lib/db/src/index.ts priority
- `drizzle.config.ts`: `DATABASE_URL` first → always uses Helium in dev
- `lib/db/src/index.ts`: `SUPABASE_DATABASE_URL` first → uses Supabase if that env var is present

## Scheduler race condition at startup
Scheduler runs before startup migrations complete → first tick shows "column X does not exist". This is cosmetic — after startup migrations OK, subsequent scheduler ticks work fine.

## Migration target alignment

When `DATABASE_URL` is present in development, migration helpers must prioritize it as well; otherwise the schema can be applied to Supabase dev while the API still queries HeliumDB.

**Why:** The billing page failed because the API and migration runner pointed at different development databases.

**How to apply:** Use `DATABASE_URL` first for local development migrations, then restart the API and verify an authenticated endpoint.
