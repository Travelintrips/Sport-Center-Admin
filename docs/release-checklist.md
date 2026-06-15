# Release Checklist — Sport Center Jakarta

Dokumen ini wajib diikuti setiap kali melakukan deploy ke production.

---

## 1. Pre-Deploy: Environment Checklist

Verifikasi semua env var berikut tersedia di scope **production** sebelum deploy.

### Wajib Ada (Fatal jika tidak ada)

| Variable | Scope | Keterangan |
|---|---|---|
| `SUPABASE_DATABASE_URL` | production | Supabase Postgres production (port 6543 transaction pooler) |
| `SUPABASE_SERVICE_ROLE_KEY` | production | Service role key untuk Supabase Storage |
| `SESSION_SECRET` | shared / secret | HMAC-SHA256 secret untuk password & JWT |
| `NODE_ENV` | production | Harus `production` (diset otomatis oleh Replit Deploy) |

### Wajib Ada (Realtime no-op jika tidak ada — tidak fatal)

| Variable | Scope | Keterangan |
|---|---|---|
| `SUPABASE_URL` | production | Supabase project URL untuk realtime broadcast |
| `SUPABASE_ANON_KEY` | production | Anon key untuk realtime client |

### Wajib Ada (Fitur sync tidak aktif jika tidak ada)

| Variable | Scope | Keterangan |
|---|---|---|
| `BIZPORTAL_SYNC_API_KEY` | shared | API key untuk pull sync dari BizPortal |
| `OPENAI_API_KEY` | shared | Untuk AI WhatsApp assistant (non-fatal jika kosong) |
| `FONNTE_TOKEN` | shared | Untuk WhatsApp notification (non-fatal jika kosong) |

### Wajib TIDAK ADA di Production

| Variable | Alasan |
|---|---|
| `ALLOW_DEV_ON_PROD_DB` | Startup akan FATAL jika di-set `true` di production |
| `ALLOW_DEV_ON_PROD_STORAGE` | Startup akan FATAL jika di-set `true` di production |
| `SUPABASE_DATABASE_URL_DEV` | Hanya untuk development — sistem akan WARN jika ada di production |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Hanya untuk development |
| `SUPABASE_URL_DEV` | Hanya untuk development |
| `SUPABASE_ANON_KEY_DEV` | Hanya untuk development |

### Verifikasi via Endpoint (post-deploy)

```bash
# Health check dasar
curl https://<domain>/api/health

# Sync health (tanpa API key)
curl https://<domain>/api/sync/health

# Diagnostic lengkap (butuh admin token)
curl -H "Authorization: Bearer <admin_token>" \
     https://<domain>/api/admin/system/supabase-status
```

---

## 2. DB Migration Checklist

- [ ] Jalankan `pnpm --filter @workspace/db run push` di dev terlebih dahulu, verifikasi schema tidak error.
- [ ] Buat backup production DB sebelum apply migration (gunakan Supabase Dashboard → Backups).
- [ ] Apply SQL migration ke production via Supabase SQL Editor atau session pooler port 5432.
- [ ] Verifikasi tabel baru muncul di Supabase Dashboard → Table Editor.
- [ ] Pastikan `runStartupMigrations()` tidak mengandung DDL yang merusak data existing (hanya `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- [ ] Jangan pernah jalankan `DROP TABLE`, `TRUNCATE`, atau `ALTER TYPE ... RENAME VALUE` tanpa backup.

---

## 3. Storage Bucket Checklist

- [ ] Verifikasi bucket `facility-images` ada di Supabase Dashboard → Storage.
- [ ] Verifikasi bucket `payment-proofs` ada di Supabase Dashboard → Storage.
- [ ] Kedua bucket harus berstatus **public** (karena diakses langsung via URL oleh frontend).
- [ ] Jangan hapus bucket — hapus file individual saja jika diperlukan.
- [ ] Verifikasi via `/api/admin/system/supabase-status` → `storage.buckets` menampilkan `"ok": true`.
- [ ] Jangan pernah run `createBucket()` secara manual di production — buat via Supabase Dashboard.

---

## 4. Sync API Checklist

- [ ] Verifikasi `BIZPORTAL_SYNC_API_KEY` tersedia di shared env (bukan production-only).
- [ ] Test `/api/sync/health` menampilkan `"configured": true` untuk pull sync.
- [ ] Jika push sync ke BizPortal aktif, verifikasi `SUPABASE_DATABASE_URL` bisa diakses dari production server.
- [ ] Jangan ganti `BIZPORTAL_SYNC_API_KEY` tanpa koordinasi dengan tim BizPortal — akan memutus pull sync.
- [ ] Jika perlu rotate key: update di sini dulu, deploy, baru update di BizPortal.

---

## 5. Smoke Test Checklist (Post-Deploy)

Jalankan test berikut setelah deploy, **tanpa menulis data ke production**:

```bash
BASE=https://<domain>
ADMIN_TOKEN=<token_dari_admin_login>

# 1. API health
curl $BASE/api
# Expected: {"status":"ok"}

# 2. Sync health (public, no key)
curl $BASE/api/sync/health
# Expected: {"ok":true,"pull":{"configured":true},"push":{"configured":true}}

# 3. System diagnostic (admin only, no secrets in response)
curl -H "Authorization: Bearer $ADMIN_TOKEN" $BASE/api/admin/system/supabase-status
# Expected: semua configured=true, tidak ada URL/key, safeMode="ACTIVE"

# 4. Facilities list (baca saja, tidak menulis)
curl $BASE/api/facilities
# Expected: array fasilitas

# 5. Settings (baca saja)
curl $BASE/api/settings
# Expected: object settings center

# 6. Frontend homepage
curl -I $BASE/
# Expected: HTTP 200
```

**DILARANG saat smoke test:**
- Membuat booking baru
- Upload payment proof
- Mengubah status booking
- Mengubah data fasilitas atau settings
- Menjalankan seed demo (`POST /api/admin/seed-demo`)

---

## 6. Rollback Plan

### Kapan rollback?

Rollback segera jika setelah deploy terjadi salah satu:
- API mengembalikan 500 untuk endpoint utama (facilities, bookings, availability)
- Login admin gagal
- File upload gagal (payment proof / facility images)
- DB connection error di logs
- Startup tidak mencapai "Server listening"

### Prosedur rollback (urutan wajib):

**Step 1 — Rollback code:**
Di Replit Dashboard → Deployments → Previous deployment → "Re-deploy this version"

**Step 2 — Restore env jika ada perubahan:**
Jika env var diubah saat deploy yang bermasalah, restore nilai sebelumnya via Replit Secrets.
- Jangan ubah `SUPABASE_DATABASE_URL` kecuali DB memang diganti
- Jangan ubah `SESSION_SECRET` — akan invalidate semua sesi user

**Step 3 — Disable realtime sementara (opsional):**
Jika masalah terkait realtime/Supabase URL:
- Kosongkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di production env
- Realtime akan otomatis no-op, tidak ada data loss
- Re-deploy untuk apply

**Step 4 — Disable BizPortal pull sync sementara (opsional):**
Jika masalah terkait sync:
- Kosongkan `BIZPORTAL_SYNC_API_KEY` di production env
- Semua `/api/sync/*` endpoint akan return 503
- Re-deploy untuk apply

**Step 5 — Verifikasi data:**
Setelah rollback, cek Supabase Dashboard bahwa tidak ada data corrupt:
- Table `bookings` — pastikan tidak ada booking dengan status aneh
- Table `payments` — pastikan payment proof URL masih valid
- Storage buckets — pastikan file masih ada

### Yang TIDAK boleh dilakukan saat rollback:

- Jangan `DROP TABLE` atau `TRUNCATE` apapun
- Jangan hapus bucket atau file di Storage
- Jangan reset `SESSION_SECRET` (akan logout semua user)
- Jangan ubah `SUPABASE_DATABASE_URL` ke DB yang berbeda
- Jangan jalankan seed demo di production

---

## 7. Post-Rollback Checklist

- [ ] `/api/sync/health` kembali `"ok": true`
- [ ] Admin login berhasil
- [ ] Facilities list tampil
- [ ] `/api/admin/system/supabase-status` tidak ada warning/error
- [ ] Booking bisa dilihat oleh admin
- [ ] Tidak ada error baru di deployment logs

---

## Catatan Keamanan

- **`SESSION_SECRET`** — Tidak boleh pernah diubah kecuali ada bukti compromise. Semua password hash dan token JWT akan invalid.
- **`SUPABASE_SERVICE_ROLE_KEY`** — Key ini bypass RLS Supabase. Jaga agar tidak pernah ter-expose di logs atau response API.
- **`BIZPORTAL_SYNC_API_KEY`** — Koordinasi dengan tim BizPortal sebelum rotate.
- **Production DB** — Hanya akses via Supabase Dashboard atau session pooler port 5432. Jangan share connection string.
