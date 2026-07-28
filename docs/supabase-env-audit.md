# Supabase Environment Audit

**Last updated:** 2026-06-15  
**Status:** ✅ FINAL — DB + Storage + Realtime fully isolated (dev ≠ prod)

---

## Status Final

| Komponen | Status | Detail |
|---|---|---|
| **Database (dev)** | ✅ **Isolated** | Replit heliumdb via `SUPABASE_DATABASE_URL_DEV` |
| **Database (prod)** | ✅ **Protected** | Supabase `nzdweipzckfszczzqtuw` via `SUPABASE_DATABASE_URL` |
| **Storage (dev)** | ✅ **Isolated** | Supabase `xssrfshdrtdfupgqwfdw` via `SUPABASE_SERVICE_ROLE_KEY_DEV` |
| **Storage (prod)** | ✅ **Protected** | Supabase `nzdweipzckfszczzqtuw` via `SUPABASE_SERVICE_ROLE_KEY` |
| **Realtime (dev)** | ✅ **Isolated** | Supabase `xssrfshdrtdfupgqwfdw` via `SUPABASE_URL_DEV` + `SUPABASE_ANON_KEY_DEV` |
| **Realtime (prod)** | ✅ **Protected** | Supabase `nzdweipzckfszczzqtuw` via `SUPABASE_URL` + `SUPABASE_ANON_KEY` |
| **DB override** | ✅ **Disabled** | `ALLOW_DEV_ON_PROD_DB` dihapus |
| **Storage override** | ✅ **Disabled** | `ALLOW_DEV_ON_PROD_STORAGE` tidak di-set (defaults `false`) |

---

## Isolation Policy

### Database
| Kondisi | Perilaku |
|---|---|
| `NODE_ENV=development` + `SUPABASE_DATABASE_URL_DEV` set | ✅ Start — pakai isolated dev DB |
| `NODE_ENV=development` + `ALLOW_DEV_ON_PROD_DB=true` | ⚠️ Start dengan WARNING — pakai prod DB |
| `NODE_ENV=development` + tidak ada keduanya | ❌ **Server MENOLAK start (throw)** |
| `NODE_ENV=production` + `SUPABASE_DATABASE_URL` | ✅ Start — pakai prod DB |

### Storage
| Kondisi | Perilaku |
|---|---|
| `NODE_ENV=development` + `SUPABASE_SERVICE_ROLE_KEY_DEV` set | ✅ Start — upload ke dev Supabase bucket |
| `NODE_ENV=development` + `ALLOW_DEV_ON_PROD_STORAGE=true` | ⚠️ Start dengan WARNING besar — upload ke prod |
| `NODE_ENV=development` + tidak ada keduanya | ❌ **`process.exit(1)` — server MENOLAK start** |
| `NODE_ENV=production` + `SUPABASE_SERVICE_ROLE_KEY` | ✅ Start — upload ke prod Supabase bucket |

### Realtime (Supabase Realtime)
| Kondisi | Perilaku |
|---|---|
| `NODE_ENV=development` + `SUPABASE_URL_DEV` + `SUPABASE_ANON_KEY_DEV` | ✅ Realtime aktif ke dev project |
| `NODE_ENV=development` + salah satu tidak ada | ⚠️ Realtime no-op (tidak fatal) |
| `NODE_ENV=production` + `SUPABASE_URL` + `SUPABASE_ANON_KEY` | ✅ Realtime aktif ke prod project |

---

## Database Priority Logic (`lib/db/src/index.ts`)

```
NODE_ENV=production:
  1. SUPABASE_DATABASE_URL   ← primary prod Supabase DB (nzdweipzckfszczzqtuw)
  2. DATABASE_URL            ← generic fallback (warns if used in prod)

NODE_ENV=development:
  1. SUPABASE_DATABASE_URL_DEV  ← REQUIRED — isolated dev DB (Replit heliumdb)
  2. ALLOW_DEV_ON_PROD_DB=true  → pakai prod DB (EMERGENCY ONLY, loud warning)
  3. Tidak ada keduanya         → throw Error, server crash
```

## Storage Logic (`lib/supabaseStorage.ts`)

```
NODE_ENV=production:
  SUPABASE_SERVICE_ROLE_KEY → derive project URL from JWT ref
  → upload ke nzdweipzckfszczzqtuw.supabase.co

NODE_ENV=development:
  1. SUPABASE_SERVICE_ROLE_KEY_DEV  ← REQUIRED — isolated dev bucket
     → upload ke xssrfshdrtdfupgqwfdw.supabase.co
  2. ALLOW_DEV_ON_PROD_STORAGE=true → upload ke prod (EMERGENCY ONLY)
  3. Tidak ada keduanya             → process.exit(1)
```

## Realtime Logic (`lib/supabase.ts`)

```
NODE_ENV=production:
  SUPABASE_URL + SUPABASE_ANON_KEY → realtime ke nzdweipzckfszczzqtuw

NODE_ENV=development:
  1. SUPABASE_URL_DEV + SUPABASE_ANON_KEY_DEV → realtime ke xssrfshdrtdfupgqwfdw
  2. Salah satu tidak ada → realtime = no-op (bukan fatal, tapi dilaporkan di diagnostic)
```

---

## Active Environment Variables

### Development
| Variable | Status | Purpose |
|---|---|---|
| `SUPABASE_DATABASE_URL_DEV` | ✅ set | DB → Replit heliumdb (isolated) |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | ✅ set | Storage → dev Supabase `xssrfshdrtdfupgqwfdw` |
| `SUPABASE_URL_DEV` | ✅ set | Realtime → dev Supabase `xssrfshdrtdfupgqwfdw` |
| `SUPABASE_ANON_KEY_DEV` | ✅ set | Realtime → dev Supabase `xssrfshdrtdfupgqwfdw` |
| `SUPABASE_URL` | ✅ set | Dari .replit dev section (Storage derivasi URL dari JWT, bukan var ini) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ set | Dari .replit dev section (diabaikan di dev karena _DEV variant ada) |
| `SUPABASE_ANON_KEY` | ✅ set | Dari .replit dev section (diabaikan di dev karena _DEV variant ada) |
| `ALLOW_DEV_ON_PROD_DB` | ❌ removed | Emergency override — dinonaktifkan |
| `ALLOW_DEV_ON_PROD_STORAGE` | ❌ not set | Defaults to `false` |

### Production
| Variable | Status | Purpose |
|---|---|---|
| `SUPABASE_DATABASE_URL` | ✅ set | DB → Supabase `nzdweipzckfszczzqtuw` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ set | Storage → Supabase `nzdweipzckfszczzqtuw` |
| `SUPABASE_URL` | ✅ set | Realtime + public config |
| `SUPABASE_ANON_KEY` | ✅ set | Realtime + frontend |

---

## Diagnostic Endpoint

```
GET /api/admin/system/supabase-status
Authorization: Bearer <admin-token>
```

Fields baru yang ditambahkan pada Phase 2:

```json
{
  "storage": {
    "storageProjectSource": "SUPABASE_SERVICE_ROLE_KEY_DEV (dev — isolated, ref=xssrfshdrtdfupgqwfdw)",
    "isDevUsingProdStorage": false,
    "allowDevOnProdStorage": false,
    "warning": null
  },
  "realtime": {
    "realtimeProjectSource": "SUPABASE_URL_DEV (dev — isolated, ref=xssrfshdrtdfupgqwfdw)",
    "isRealtimeNoop": false
  }
}
```

Diagnostic TIDAK pernah mengekspos: service role key, anon key, URL lengkap, atau koneksi string.
Hanya `ref` (project ID) yang tampil, bukan credentials.

---

## Test Results (2026-06-15)

| Test | Result | Detail |
|---|---|---|
| Startup isolation check (DB) | ✅ PASS | Log: `SUPABASE_DATABASE_URL_DEV (dev — isolated)` |
| Startup isolation check (Storage) | ✅ PASS | Log: `Bucket "..." exists (env=dev)` |
| Guard: server exit tanpa `SUPABASE_SERVICE_ROLE_KEY_DEV` | ✅ PASS | `process.exit(1)` + FATAL banner |
| Upload payment-proof | ✅ PASS | URL: `xssrfshdrtdfupgqwfdw.supabase.co/...payment-proofs/...` |
| Upload facility-image | ✅ PASS | URL: `xssrfshdrtdfupgqwfdw.supabase.co/...facility-images/...` |
| Diagnostic: `isDevUsingProdStorage=false` | ✅ PASS | |
| Diagnostic: `storageProjectSource` menampilkan ref, bukan key | ✅ PASS | |
| Diagnostic: `isRealtimeNoop=false` | ✅ PASS | |
| Production bucket tidak berubah | ✅ PASS | Prod project `nzdweipzckfszczzqtuw` tidak disentuh |

---

## Dev Seed Data

| Type | Detail |
|---|---|
| Admin | `admin@sportcenter.com` / `admin123` |
| Customer 1 | `budi.dev@example.com` / `customer123` (CST-DEV-001) |
| Customer 2 | `dewi.dev@example.com` / `customer123` (CST-DEV-002) |
| Tenant | `tenant.dev@example.com` / `customer123` |
| Facility 1 | Lapangan Futsal A (DEV) — Rp 150.000/jam |
| Facility 2 | Lapangan Badminton 1 (DEV) — Rp 80.000/jam |
| Booking 1 | `ORD-DEV-20260615-001` — confirmed |
| Booking 2 | `ORD-DEV-20260615-002` — pending_payment |
| Payment | Booking 1 — Rp 300.000 — confirmed |
| Membership | Budi Santoso — 1 bulan — active |

---

## Deprecated / Removed Variables

| Variable | Status | Action |
|---|---|---|
| `SUPABASE_PG_URL` | ❌ removed | Alias duplikat, tidak dipakai |
| `SUPABASE_STORAGE_BUCKET` | set-but-unused | Diabaikan; bucket dialamatkan by name |
| `ALLOW_DEV_ON_PROD_DB` | ❌ removed | Emergency override, dinonaktifkan |

---

## Risiko Tersisa

| Risiko | Severity | Mitigasi |
|---|---|---|
| Dev Supabase project `xssrfshdrtdfupgqwfdw` juga digunakan oleh project lain | Medium | Pisahkan ke project dedicated jika bucket clash jadi masalah |
| Realtime no-op jika `SUPABASE_URL_DEV` tidak di-set | Low | Tidak fatal; `isRealtimeNoop` terekspos di diagnostic |
| BizPortal push sync disabled di dev | Info | `SUPABASE_DATABASE_URL` tidak ada di dev — expected behavior |
| `SUPABASE_STORAGE_BUCKET` env var masih set tapi diabaikan | Low | Documented deprecated, tidak ada dampak fungsional |

---

## Isolation Guarantee

```
Dev DB writes    → Replit heliumdb ONLY (tidak menyentuh Supabase prod)
Dev file uploads → Supabase xssrfshdrtdfupgqwfdw ONLY (tidak menyentuh bucket prod)
Dev realtime     → Supabase xssrfshdrtdfupgqwfdw ONLY

Prod DB          → Supabase nzdweipzckfszczzqtuw ONLY
Prod Storage     → Supabase nzdweipzckfszczzqtuw ONLY
Prod Realtime    → Supabase nzdweipzckfszczzqtuw ONLY

Zero cross-contamination between environments.
```
