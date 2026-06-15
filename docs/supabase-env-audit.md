# Supabase Environment Variables Audit

> Last updated: June 2026  
> Project: Sport Center API Server

---

## Active Environment Variables

These variables are actively read and used by the application.

| Variable | Where Used | Required | Notes |
|----------|-----------|----------|-------|
| `SUPABASE_DATABASE_URL` | `lib/db/src/index.ts` (production primary), `lib/bizportalSync.ts` (BizPortal push pool) | Yes (prod) | Transaction pooler URL (port 6543). Used as primary DB in `NODE_ENV=production`. Also used by bizportalSync to write to BizPortal's `public.sport_center_bookings` / `public.sport_center_memberships`. |
| `SUPABASE_DATABASE_URL_DEV` | `lib/db/src/index.ts` (development primary) | Yes (dev, recommended) | Should point to a **separate** Supabase project or Replit Postgres. If not set, dev falls back to `DATABASE_URL`. If neither exists, dev falls back to prod DB with a warning. |
| `DATABASE_URL` | `lib/db/src/index.ts` (fallback for both envs) | No | Replit managed PostgreSQL. Used when Supabase URLs are not available. |
| `SUPABASE_URL` | `artifacts/api-server/src/lib/supabase.ts` (Realtime client) | No | Required to enable Supabase Realtime availability broadcasts. If missing, broadcasts are no-ops (logged once at startup). |
| `SUPABASE_ANON_KEY` | `artifacts/api-server/src/lib/supabase.ts` (Realtime client), `routes/config.ts` (public config for frontend) | No | Required alongside `SUPABASE_URL` for Realtime. Also served to frontend via `/api/config/public`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `artifacts/api-server/src/lib/supabaseStorage.ts` | Yes (for uploads) | Server-side only. Required for facility image and payment proof uploads to Supabase Storage. Project ref is derived from this key's JWT payload. |
| `BIZPORTAL_SYNC_API_KEY` | `artifacts/api-server/src/routes/sync.ts` (pull endpoints) | Yes (for pull sync) | BizPortal must send this as `X-API-Key` header to access `/api/sync/*`. Without it, all pull endpoints return `503`. |

---

## Database Priority Logic (`lib/db/src/index.ts`)

```
NODE_ENV=production:
  1. SUPABASE_DATABASE_URL   ← primary
  2. DATABASE_URL            ← fallback

NODE_ENV=development (default):
  1. SUPABASE_DATABASE_URL_DEV   ← primary (isolated dev DB)
  2. DATABASE_URL                ← fallback (Replit Postgres)
  3. SUPABASE_DATABASE_URL       ← last resort (logs loud WARNING)
```

If dev falls through to `SUPABASE_DATABASE_URL` (prod), a **console.warn** is emitted on every startup:
> ⚠️ WARNING: SUPABASE_DATABASE_URL_DEV is not set. Development environment is connected to the PRODUCTION Supabase database.

---

## Deprecated Environment Variables

These variables are **set in the Replit secrets** but are **not read by any application code**. They should not be deleted immediately (backward compat / documentation), but are marked deprecated.

| Variable | Status | Reason |
|----------|--------|--------|
| `SUPABASE_URL_DEV` | **DEPRECATED — set but unused** | Was intended for a dev Supabase project URL. The codebase never reads this variable. Use `SUPABASE_DATABASE_URL_DEV` instead (PostgreSQL connection string, not the REST URL). |
| `SUPABASE_PG_URL` | **DEPRECATED — set but unused** | Points to the same Supabase instance as `SUPABASE_DATABASE_URL`. Redundant alias. Can be removed once confirmed no external scripts depend on it. |
| `SUPABASE_STORAGE_BUCKET` | **DEPRECATED — set but unused** | Originally may have been intended for dynamic bucket addressing. Buckets are now addressed by explicit constant names (`facility-images`, `payment-proofs`) in `lib/supabaseStorage.ts`. The value in this env var is an S3-compatible URL and is never read. |

---

## Supabase Storage Buckets

| Bucket | Access | Max Size | Accepted Types | Used By |
|--------|--------|----------|----------------|---------|
| `facility-images` | Public | 5 MB | JPEG, PNG, WebP | Admin Portal — facility photo upload |
| `payment-proofs` | Public | 10 MB | JPEG, PNG, WebP, PDF | Customer Portal, Admin, Tenant, WA Bot — payment proof upload |

Buckets are validated at server startup via `validateBuckets()`:
- **Production**: logs an error if bucket is missing; does NOT auto-create.
- **Development**: auto-creates missing buckets with correct settings.

---

## BizPortal Sync Architecture

### Push (Sport Center → BizPortal)

Triggered automatically on these events:

| Event | File | BizPortal Table Updated |
|-------|------|------------------------|
| Booking created | `routes/bookings.ts` | `public.sport_center_bookings` |
| Payment proof uploaded | `routes/payments.ts`, `routes/whatsapp.ts` | `public.sport_center_bookings` |
| Admin confirms payment | `routes/bookings.ts`, `routes/payments.ts` | `public.sport_center_bookings` |
| Admin rejects booking | `routes/bookings.ts` | `public.sport_center_bookings` |
| Booking cancelled | `routes/cancellations.ts` | `public.sport_center_bookings` |
| WA bot upload proof | `routes/whatsapp.ts` | `public.sport_center_bookings` |
| WA bot confirm | `routes/whatsapp.ts` | `public.sport_center_bookings` |
| Membership created/updated | `routes/memberships.ts` | `public.sport_center_memberships` |

All pushes use **upsert** (`ON CONFLICT ... DO UPDATE`) with retry (max 2 retries, 1s backoff).

### Pull (BizPortal → Sport Center)

BizPortal can pull data via REST API:

| Endpoint | Description |
|----------|-------------|
| `GET /api/sync/health` | Public health check — no auth required |
| `GET /api/sync/bookings` | Bookings with payment + facility data |
| `GET /api/sync/facilities` | Active facility list |
| `GET /api/sync/memberships` | Gym membership list |
| `GET /api/sync/stats` | Daily/monthly revenue stats |

All pull endpoints (except `/health`) require: `X-API-Key: <BIZPORTAL_SYNC_API_KEY>`

---

## Admin Diagnostic Endpoint

`GET /api/admin/system/supabase-status` (requires admin login)

Returns:
- Active DB source
- Storage bucket status
- Realtime enabled/disabled
- BizPortal sync configured + last sync result
- Deprecated env var status

No secret values are exposed.
