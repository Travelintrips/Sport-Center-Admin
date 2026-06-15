# Supabase Environment Audit

**Last updated:** 2026-06-15  
**Status:** ✅ FINAL — Dev Isolated, Prod Protected, Emergency Override Disabled

---

## Status Final

| Komponen | Status | Detail |
|---|---|---|
| **DEV DB** | ✅ **Isolated** | Replit PostgreSQL (heliumdb) via `SUPABASE_DATABASE_URL_DEV` |
| **PROD DB** | ✅ **Protected** | Supabase `nzdweipzckfszczzqtuw` via `SUPABASE_DATABASE_URL` (prod only) |
| **Emergency override** | ✅ **Disabled** | `ALLOW_DEV_ON_PROD_DB` dihapus dari development env |

---

## Dev/Prod Isolation Policy

**Development MUST NOT share a database with production.**

Server menegakkan ini di startup via hard guard di `lib/db/src/index.ts`:

| Kondisi | Perilaku |
|---|---|
| `NODE_ENV=development` + `SUPABASE_DATABASE_URL_DEV` set | ✅ Server start — pakai isolated dev DB |
| `NODE_ENV=development` + no dev DB + `ALLOW_DEV_ON_PROD_DB=true` | ⚠️ Server start dengan warning — pakai prod DB (EMERGENCY ONLY) |
| `NODE_ENV=development` + no dev DB + `ALLOW_DEV_ON_PROD_DB` not set | ❌ **Server MENOLAK start** dengan error jelas |
| `NODE_ENV=production` + `SUPABASE_DATABASE_URL` set | ✅ Server start — pakai prod DB |
| `NODE_ENV=production` + no `SUPABASE_DATABASE_URL` | ⚠️ Server start dengan warning — fallback ke `DATABASE_URL` |

---

## Database Priority Logic (`lib/db/src/index.ts`)

```
NODE_ENV=production:
  1. SUPABASE_DATABASE_URL   ← primary prod Supabase DB
  2. DATABASE_URL            ← generic fallback (warns if used in prod)

NODE_ENV=development:
  1. SUPABASE_DATABASE_URL_DEV   ← REQUIRED — isolated dev DB
  2. [BLOCKED] — server MENOLAK start kecuali:
     └─ ALLOW_DEV_ON_PROD_DB=true → pakai SUPABASE_DATABASE_URL (dengan WARNING besar)
```

---

## Active Environment Variables

### Shared (dev + prod)
| Variable | Status | Notes |
|---|---|---|
| `SESSION_SECRET` | ✅ set | HMAC-SHA256 untuk password hashing |
| `OPENAI_API_KEY` | ✅ set | AI WhatsApp assistant |
| `FONNTE_TOKEN` | ✅ set | WhatsApp notification gateway |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ set | Google Sheets integration |
| `BIZPORTAL_SYNC_API_KEY` | ✅ set | BizPortal pull API auth |

### Development only
| Variable | Status | Notes |
|---|---|---|
| `SUPABASE_DATABASE_URL_DEV` | ✅ **set** | Replit heliumdb — **isolated dari prod** |
| `SUPABASE_URL` | ✅ set | Dev Supabase project (`xssrfshdrtdfupgqwfdw`) — untuk Storage/Realtime |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ set | Dev Supabase service role |
| `SUPABASE_ANON_KEY` | ✅ set | Dev Supabase anon key |
| `ALLOW_DEV_ON_PROD_DB` | ❌ **removed** | Emergency override — **dinonaktifkan** |
| `SUPABASE_DATABASE_URL` | ❌ **removed** | Tidak ada di dev (production only) |
| `SUPABASE_PG_URL` | ❌ **removed** | Alias duplikat, tidak dipakai |

### Production only
| Variable | Status | Notes |
|---|---|---|
| `SUPABASE_DATABASE_URL` | ✅ set | Supabase prod project (`nzdweipzckfszczzqtuw`) |
| `SUPABASE_URL` | ✅ set | Prod Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ set | Prod Supabase service role |
| `SUPABASE_ANON_KEY` | ✅ set | Prod Supabase anon key |

---

## Diagnostic Endpoint

```
GET /api/admin/system/supabase-status
Authorization: Bearer <admin-token>
```

Expected response saat dev isolation aktif (✅ target state):
```json
{
  "database": {
    "dbEnvironment": "development",
    "dbSource": "SUPABASE_DATABASE_URL_DEV (dev — isolated)",
    "configured": true,
    "isDevUsingProdDb": false,
    "allowDevOnProdDb": false,
    "devDbConfigured": true,
    "prodDbConfigured": false,
    "warning": null
  }
}
```

---

## Deprecated / Removed Variables

| Variable | Status | Action |
|---|---|---|
| `SUPABASE_PG_URL` | ❌ removed from dev | Alias duplikat dari `SUPABASE_DATABASE_URL`, tidak dipakai kode |
| `SUPABASE_STORAGE_BUCKET` | set-but-unused | Storage bucket dialamatkan by name di kode, var ini diabaikan |
| `SUPABASE_URL_DEV` | not-set | Tidak dibaca oleh code path manapun |

---

## Dev Seed Data (Dummy — hanya di dev DB)

Data ini **tidak ada di production** dan tidak boleh berpindah ke production.

| Type | Detail |
|---|---|
| **Admin** | `admin@sportcenter.com` / `admin123` |
| **Customer 1** | `budi.dev@example.com` / `customer123` (CST-DEV-001) |
| **Customer 2** | `dewi.dev@example.com` / `customer123` (CST-DEV-002) |
| **Tenant** | `tenant.dev@example.com` / `customer123` — Kantin Sport Center Dev |
| **Facility 1** | Lapangan Futsal A (DEV) — Rp 150.000/jam |
| **Facility 2** | Lapangan Badminton 1 (DEV) — Rp 80.000/jam |
| **Booking 1** | `ORD-DEV-20260615-001` — Budi Santoso — status: `confirmed` |
| **Booking 2** | `ORD-DEV-20260615-002` — Dewi Rahayu — status: `pending_payment` |
| **Payment** | Booking 1 — Rp 300.000 — status: `confirmed` |
| **Membership** | Budi Santoso — 1 bulan — status: `active` |
| **Tenant** | Kantin Sport Center Dev — status: `active` |

---

## Migration Status

Schema dev DB setelah isolasi:

- ✅ 44 tabel `sport_center.*` created
- ✅ Semua enum types created
- ✅ Foreign key constraints intact
- ✅ Migration: `lib/db/drizzle/0000..0003_*.sql` + manual `ALTER TABLE`
- ✅ Post-merge script: `scripts/post-merge.sh` menjalankan `pnpm --filter db push`

---

## Isolation Guarantee

```
Dev writes  → Replit heliumdb (DATABASE_URL) ONLY
Prod reads  → Supabase nzdweipzckfszczzqtuw ONLY
No cross-contamination between environments
```

---

## BizPortal Sync Architecture

### Push (Sport Center → BizPortal)
Menggunakan `SUPABASE_DATABASE_URL` pool langsung (selalu target prod).

| Event | Route File | BizPortal Table |
|---|---|---|
| Booking created | `routes/bookings.ts` | `public.sport_center_bookings` |
| Payment proof uploaded | `routes/payments.ts`, `routes/whatsapp.ts` | `public.sport_center_bookings` |
| Admin confirms payment | `routes/bookings.ts`, `routes/payments.ts` | `public.sport_center_bookings` |
| Membership created/updated | `routes/memberships.ts` | `public.sport_center_memberships` |

### Pull (BizPortal → Sport Center)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/sync/health` | None | Public status check |
| `GET /api/sync/bookings` | `X-API-Key` | Bookings + payment + facility |
| `GET /api/sync/facilities` | `X-API-Key` | Active facility list |
| `GET /api/sync/memberships` | `X-API-Key` | Gym membership list |
| `GET /api/sync/stats` | `X-API-Key` | Revenue stats |
