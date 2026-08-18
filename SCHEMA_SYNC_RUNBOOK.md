# Schema Sync Runbook — Sport Center Jakarta

> **TL;DR** — Never use `drizzle-kit push` against either Supabase database. Use the commands below instead.

---

## Why `drizzle-kit push` is disabled

The project shares a Supabase instance with 150+ tables from other apps in the `public` schema. `drizzle-kit push` introspects every table before comparing — it hangs for minutes and then times out. All schema changes are applied through targeted, idempotent SQL scripts.

---

## Key files

| File | Purpose |
|------|---------|
| `scripts/migrate.ts` | Single source of truth — all `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` / enum extensions |
| `scripts/fix_settings_cols.ts` | Legacy: settings-table columns + tax_settings seed (superseded by `db-migrate.ts`) |
| `scripts/src/db-migrate.ts` | Migration runner — connects to DEV or PROD, applies drizzle baseline + custom SQL |
| `scripts/src/schema-diff.ts` | Diff checker — compares DEV vs PROD column-by-column, exits non-zero if PROD is behind |
| `scripts/compare-schema.ts` | Quick table + enum summary for both DBs (no column detail) |
| `lib/db/drizzle/` | Drizzle-generated numbered SQL files (0000, 0001, 0002) — only run once on a fresh DB |

---

## Environment variables

| Variable | Value | Used by |
|----------|-------|---------|
| `SUPABASE_DATABASE_URL_DEV` | Dev Supabase connection string (session pooler, port 5432) | `migrate:dev`, `migrate:diff` |
| `SUPABASE_DATABASE_URL` | Prod Supabase connection string (session pooler, port 5432) | `migrate:prod`, `migrate:diff` |

> The scripts automatically rewrite `:6543` → `:5432` (session pooler, required for DDL).  
> Set both secrets in the Replit Secrets panel; never commit them.

---

## Day-to-day workflow

### 1. Adding a new table or column

Edit `scripts/migrate.ts` and add your DDL inside `CUSTOM_MIGRATION_SQL`.  
All statements **must** be idempotent:

```sql
-- Table
CREATE TABLE IF NOT EXISTS sport_center.my_table ( … );

-- Column
ALTER TABLE sport_center.my_table
  ADD COLUMN IF NOT EXISTS my_col text;

-- Enum value
DO $$ BEGIN
  ALTER TYPE sport_center.my_enum ADD VALUE IF NOT EXISTS 'new_value';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 2. Apply to DEV

```bash
pnpm --filter scripts migrate:dev
```

Runs in the terminal inside the Replit workspace (requires `SUPABASE_DATABASE_URL_DEV`).

### 3. Diff DEV vs PROD (before every deploy)

```bash
pnpm --filter scripts migrate:diff
```

Output example when PROD is behind:

```
━━━ Columns (sport_center schema) ━━━━━━━━━━━━━━━━━━━━━━━
  ❌ Missing columns in PROD (2 total):

     sport_center.sport_bookings:
       + booking_type  (text)
       + event_discount_amount  (numeric)

━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⚠️  2 schema items are missing in PROD.

  Run the migration to fix:

    pnpm --filter scripts migrate:prod
```

Exit code `0` = PROD is up to date. Exit code `1` = PROD is behind.

### 4. Apply to PROD

```bash
pnpm --filter scripts migrate:prod
```

Re-run the diff to confirm zero gaps before deploying.

### 5. Deploy

Only deploy once `migrate:diff` exits with code `0`.

---

## After a task merge (automated)

`scripts/post-merge.sh` runs automatically after every task merge:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter scripts migrate:dev`

This keeps the DEV database in sync with every merge.

---

## Troubleshooting

### "SUPABASE_DATABASE_URL_DEV is not set"
Open Replit Secrets and set `SUPABASE_DATABASE_URL_DEV` to your dev Supabase connection string (session pooler URL, port 5432).

### "SSL connection required"
The scripts use `ssl: { rejectUnauthorized: false }` automatically for Supabase URLs. No extra config needed.

### Migration fails mid-way
All statements use `IF NOT EXISTS` / `DO $$ BEGIN … EXCEPTION WHEN … END $$` guards, so they are safe to re-run. Just re-run `migrate:dev` or `migrate:prod` after fixing the issue.

### Schema has tables drizzle doesn't know about
That is expected — the `lib/db/drizzle/` folder only covers the base schema. All additions live in `scripts/migrate.ts`. Do not delete tables that appear in drizzle's tracking table but not in the schema folder.

---

## Quick reference

```bash
# Apply to dev
pnpm --filter scripts migrate:dev

# Apply to prod
pnpm --filter scripts migrate:prod

# Check what's missing in prod (before deploying)
pnpm --filter scripts migrate:diff

# Quick table+enum summary (both DBs)
cd scripts && tsx compare-schema.ts
```
