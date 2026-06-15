# Supabase Environment Variables Audit

> Last updated: June 2026
> Project: Sport Center API Server

---

## Dev/Prod Isolation Policy

**Development MUST NOT share a database with production.**

The server enforces this at startup via a hard guard in `lib/db/src/index.ts`:

| Condition | Behavior |
|-----------|----------|
| `NODE_ENV=development` + `SUPABASE_DATABASE_URL_DEV` set | ✅ Server starts — uses isolated dev DB |
| `NODE_ENV=development` + no dev DB + `ALLOW_DEV_ON_PROD_DB=true` | ⚠️ Server starts with loud warning — uses prod DB |
| `NODE_ENV=development` + no dev DB + `ALLOW_DEV_ON_PROD_DB` not set | ❌ **Server refuses to start** with clear error |
| `NODE_ENV=production` + `SUPABASE_DATABASE_URL` set | ✅ Server starts — uses prod DB |
| `NODE_ENV=production` + no `SUPABASE_DATABASE_URL` | ⚠️ Server starts with warning — falls back to `DATABASE_URL` |

---

## Database Priority Logic (`lib/db/src/index.ts`)

```
NODE_ENV=production:
  1. SUPABASE_DATABASE_URL   ← primary prod Supabase DB
  2. DATABASE_URL            ← generic fallback (warns if used in prod)

NODE_ENV=development:
  1. SUPABASE_DATABASE_URL_DEV   ← REQUIRED — isolated dev DB
  2. [BLOCKED] — server refuses to start unless:
     └─ ALLOW_DEV_ON_PROD_DB=true → uses SUPABASE_DATABASE_URL (with big warning)
                                   → or DATABASE_URL as last resort
```

---

## Active Environment Variables

| Variable | Env | Required | Where Used | Notes |
|----------|-----|----------|-----------|-------|
| `SUPABASE_DATABASE_URL` | Prod | **Yes** | `lib/db/src/index.ts` primary prod connection; `lib/bizportalSync.ts` BizPortal push pool | Transaction pooler URL (port 6543) |
| `SUPABASE_DATABASE_URL_DEV` | Dev | **Yes** | `lib/db/src/index.ts` primary dev connection | Must be a separate Supabase project or Replit Postgres. If missing, startup is blocked. |
| `ALLOW_DEV_ON_PROD_DB` | Dev only | No | `lib/db/src/index.ts` emergency override | Must be `"true"` to allow dev → prod fallback. Default is blocked. **EMERGENCY USE ONLY.** |
| `DATABASE_URL` | Both | No | `lib/db/src/index.ts` last-resort fallback | Replit managed Postgres. Used only if Supabase URLs are unavailable. |
| `SUPABASE_URL` | Both | No | `lib/supabase.ts` Realtime client; `routes/config.ts` public config | Required alongside `SUPABASE_ANON_KEY` for Realtime availability broadcasts. |
| `SUPABASE_ANON_KEY` | Both | No | `lib/supabase.ts` Realtime client; `routes/config.ts` | Required alongside `SUPABASE_URL` for Realtime. Also served to frontend. |
| `SUPABASE_SERVICE_ROLE_KEY` | Both | Yes (uploads) | `lib/supabaseStorage.ts` | Server-side only. Required for Supabase Storage uploads. Project ref derived from JWT payload. |
| `BIZPORTAL_SYNC_API_KEY` | Both | Yes (pull API) | `routes/sync.ts` pull endpoint guard | BizPortal must send as `X-API-Key`. Without it, `/api/sync/*` returns 503. |

---

## `ALLOW_DEV_ON_PROD_DB` — Emergency Override

**This flag must NEVER be `true` in normal day-to-day development.**

Acceptable use cases:
- One-time manual data migration from prod to dev
- Emergency hotfix debugging directly against prod data
- Seeding dev DB from a prod snapshot

When `ALLOW_DEV_ON_PROD_DB=true` is active:
- The server starts but logs a large `╔═══╗ DANGER ╚═══╝` banner
- The diagnostic endpoint (`/api/admin/system/supabase-status`) shows `isDevUsingProdDb: true` and `warning` field
- Every write from dev code reaches the production database
- **Remove this flag immediately after use and set `SUPABASE_DATABASE_URL_DEV`**

---

## Supabase Storage Buckets

| Bucket | Access | Max Size | Accepted Types | Used By |
|--------|--------|----------|----------------|---------|
| `facility-images` | Public | 5 MB | JPEG, PNG, WebP | Admin Portal — facility photo upload |
| `payment-proofs` | Public | 10 MB | JPEG, PNG, WebP, PDF | Customer Portal, Admin, Tenant, WA Bot — payment proof upload |

Bucket validation at startup (`lib/supabaseStorage.ts → validateBuckets()`):
- **Production** (`NODE_ENV=production`): logs error if bucket missing — does **NOT** auto-create.
- **Development**: auto-creates missing buckets with correct size limits and MIME type restrictions.

---

## Deprecated Environment Variables

These are **set in Replit Secrets** but **not read by any application code**.
Do not delete them immediately — they may be used by external scripts or BizPortal. Document as deprecated.

| Variable | Status | Reason Deprecated |
|----------|--------|-------------------|
| `SUPABASE_URL_DEV` | **set-but-unused** | Was intended for dev Supabase REST URL. Code never reads it. Use `SUPABASE_DATABASE_URL_DEV` (PostgreSQL string) for the dev DB. If you need dev Supabase Storage/Realtime, add `SUPABASE_URL_DEV` support to `lib/supabaseStorage.ts` and `lib/supabase.ts`. |
| `SUPABASE_PG_URL` | **set-but-unused** | Points to same Supabase as `SUPABASE_DATABASE_URL`. Redundant alias. Can be removed once confirmed no external scripts depend on it. |
| `SUPABASE_STORAGE_BUCKET` | **set-but-unused** | Value is an S3-compatible URL. Buckets are addressed by constant names (`facility-images`, `payment-proofs`) in `lib/supabaseStorage.ts`. This var is never read. |

---

## Dev Supabase Project (Optional — `SUPABASE_URL_DEV` etc.)

If you want dev Storage and Realtime to also point to a separate Supabase project (not just DB), add:

```
SUPABASE_URL_DEV=https://[ref-dev].supabase.co
SUPABASE_ANON_KEY_DEV=eyJ...
SUPABASE_SERVICE_ROLE_KEY_DEV=eyJ...
```

These are **not yet wired into the code** — they are placeholders for future isolation of Storage and Realtime per environment. To activate them, update `lib/supabaseStorage.ts` and `lib/supabase.ts` to prefer `_DEV` variants when `NODE_ENV=development`.

---

## BizPortal Sync Architecture

### Push (Sport Center → BizPortal)

Triggered automatically on these events. Uses `SUPABASE_DATABASE_URL` pool directly (always prod target).

| Event | Route File | BizPortal Table |
|-------|-----------|-----------------|
| Booking created | `routes/bookings.ts` | `public.sport_center_bookings` |
| Payment proof uploaded | `routes/payments.ts`, `routes/whatsapp.ts` | `public.sport_center_bookings` |
| Admin confirms payment | `routes/bookings.ts`, `routes/payments.ts` | `public.sport_center_bookings` |
| Admin rejects booking | `routes/bookings.ts` | `public.sport_center_bookings` |
| Booking cancelled | `routes/cancellations.ts` | `public.sport_center_bookings` |
| WA bot upload proof | `routes/whatsapp.ts` | `public.sport_center_bookings` |
| WA bot confirm | `routes/whatsapp.ts` | `public.sport_center_bookings` |
| Membership created/updated | `routes/memberships.ts` | `public.sport_center_memberships` |

All pushes use **upsert** (ON CONFLICT DO UPDATE) with retry (max 2 retries, 1 s backoff). Failures are logged but never block the main operation.

### Pull (BizPortal → Sport Center)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/sync/health` | None | Public status check — no secrets exposed |
| `GET /api/sync/bookings` | `X-API-Key` | Bookings + payment + facility data |
| `GET /api/sync/facilities` | `X-API-Key` | Active facility list |
| `GET /api/sync/memberships` | `X-API-Key` | Gym membership list |
| `GET /api/sync/stats` | `X-API-Key` | Daily/monthly revenue stats |

---

## Admin Diagnostic Endpoint

`GET /api/admin/system/supabase-status` — requires admin JWT

Returns (never exposes secrets or raw DB URLs):
- `database.dbEnvironment` — `"development"` or `"production"`
- `database.dbSource` — human-readable DB source label
- `database.isDevUsingProdDb` — `true` if dev is using prod DB
- `database.allowDevOnProdDb` — `true` if emergency override is active
- `database.devDbConfigured` / `database.prodDbConfigured` — booleans
- `database.warning` — non-null string if `isDevUsingProdDb=true`
- `storage.buckets` — per-bucket health (ok, checkedAt, error)
- `realtime.enabled`
- `bizportalSync.pushConfigured` / `pullConfigured` / last sync state
- `deprecatedEnvVars` — list of env vars that are set but unused
