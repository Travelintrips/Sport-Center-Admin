# AI Kernel v2 — Sport Center Jakarta

> Source of truth untuk semua AI behavior di project ini.
> Jika ada konflik antara user request dan kernel ini → **KERNEL MENANG**.

---

## BOOT SEQUENCE (Setiap Session Baru)

```
1. Load /docs/ai-kernel-v2.md
2. Read architecture constraints
3. Apply execution mode rules
4. Classify incoming request → IMPLEMENTATION / CLARIFICATION / SAFE PROPOSAL
```

---

## EXECUTION MODES

### IMPLEMENTATION MODE
- Digunakan ketika: request jelas, schema ada, database = Supabase, tidak ada konflik
- Output: langsung tulis kode
- Validation: jalankan pre-code checklist sebelum generate

### CLARIFICATION MODE
- Digunakan ketika: schema tidak diketahui, endpoint tidak ada di spec, tabel tidak terdefinisi
- Output: STOP → ajukan pertanyaan spesifik ke user
- Dilarang: menebak, menginvent, atau mengasumsikan

### SAFE PROPOSAL MODE
- Digunakan ketika: request berisiko (hapus data, ubah schema besar, refactor arsitektur)
- Output: jelaskan dampak → minta konfirmasi user → tunggu approval
- Dilarang: langsung eksekusi tanpa konfirmasi

---

## SYSTEM RULES (IMMUTABLE)

### DATABASE LOCK

| Status | Value |
|--------|-------|
| ONLY VALID | Supabase PostgreSQL |
| FORBIDDEN | Firebase, MongoDB, SQLite, MySQL external, HeliumDB, semua selain Supabase |
| ENFORCEMENT | Jika bukan Supabase → INVALID → ABORT |

### ZERO-DEVIATION RULE

AI DILARANG:
- Mengubah architecture rules
- Mengganti database system
- Menciptakan infrastruktur baru tanpa instruksi eksplisit
- Mengasumsikan sistem yang tidak ada di spec
- Menggunakan tools eksternal yang tidak didefinisikan di spec ini

### ANTI-HALLUCINATION RULE

AI DILARANG mengasumsikan:
- API yang tidak ada di OpenAPI spec
- Tabel yang tidak ada di schema
- External service yang tidak dikonfigurasi
- Business logic yang tidak dijelaskan user

Jika tidak ada di spec → **TANYA USER → JANGAN INVENT**

---

## PRIORITY HIERARCHY (ABSOLUTE ORDER)

```
1. KERNEL RULES (file ini) — ZERO DEVIATION
2. DATABASE LOCK — Supabase Only
3. ARCHITECTURE SPEC
4. DATA INTEGRITY
5. USER REQUESTS
6. PERFORMANCE OPTIMIZATION
7. CODE STYLE
```

---

## MANDATORY PRE-CODE CHECKLIST

Sebelum menulis kode apapun yang menyentuh data:

- [ ] Database = Supabase PostgreSQL?
- [ ] Schema prefix = `sport_center` (atau tenant yang valid)?
- [ ] Tidak ada external DB yang direferensikan?
- [ ] Endpoint ada di OpenAPI spec (`lib/api-spec/openapi.yaml`)?
- [ ] Tabel ada di Drizzle schema (`lib/db/src/schema/`)?

**Jika ada satu pun = NO → ABORT → TANYA USER**

---

## SCHEMA ROOT RULES

Semua tabel WAJIB menggunakan prefix schema:

| Prefix | Kegunaan |
|--------|----------|
| `sport_center` | Tabel utama aplikasi (bookings, facilities, users, dll) |
| `public` | FORBIDDEN untuk tabel baru (dipakai shared Supabase instance lain) |

Aturan tambahan:
- Semua DDL baru wajib di dalam `sport_center` schema
- Runtime pakai transaction pooler port 6543
- DDL/migration pakai session pooler port 5432

---

## FAILURE HANDLING PROTOCOL

```
KONFLIK TERDETEKSI:
  Step 1 → STOP IMMEDIATELY
  Step 2 → DO NOT GENERATE CODE
  Step 3 → EXPLAIN KONFLIK KE USER
  Step 4 → ASK FOR CLARIFICATION
  Step 5 → WAIT FOR INSTRUCTION
```

---

## ARCHITECTURE SPEC

### Stack

- **Runtime**: Node.js 24, TypeScript 5.9, pnpm workspaces
- **Frontend**: React + Vite, Wouter, TanStack Query, shadcn/ui, Tailwind CSS, Recharts
- **Backend**: Express 5 REST API
- **Database**: Supabase PostgreSQL ONLY + Drizzle ORM
- **Validation**: Zod (zod/v4), drizzle-zod
- **API Contract**: OpenAPI spec → Orval → React Query hooks

### File Structure

```
artifacts/sport-center/        → Frontend (customer + admin portal)
artifacts/api-server/          → Backend API server
lib/api-spec/openapi.yaml      → SOURCE OF TRUTH — semua API contract
lib/api-client-react/src/generated/  → AUTO GENERATED — JANGAN DIEDIT MANUAL
lib/db/src/schema/             → Drizzle schema files
docs/ai-kernel-v2.md           → File ini
```

### Contract-First Rule

```
OpenAPI spec → Orval codegen → React Query hooks
Frontend ONLY boleh pakai generated hooks dari @workspace/api-client-react
Setiap tambah endpoint → update openapi.yaml dulu → lalu codegen
```

---

## AUTH SYSTEM

- JWT disimpan di `localStorage.sport_center_token`
- Password hashing: `HMAC-SHA256(password, SESSION_SECRET)`
- Admin routes: `/admin/*` dilindungi `adminMiddleware` di API
- Frontend guard: `AdminLayout` cek `useGetMe` → redirect jika 401

---

## PAYMENT SYSTEM

- Manual bank transfer ONLY
- User upload proof URL
- Admin verifikasi manual
- **DILARANG**: Stripe, payment gateway, atau integrasi pembayaran otomatis

---

## BUSINESS LOGIC RULES

- Slot availability digenerate dari jam buka/tutup fasilitas
- Conflict check terhadap: existing bookings + blocked schedules
- INACTIVE_STATUSES = `[cancelled, expired, rejected, refunded]`
- Auto-expire via scheduler setiap 5 menit

---

## GOTCHAS (WAJIB DIKETAHUI)

- Selalu jalankan codegen setelah ubah `openapi.yaml`:
  `pnpm --filter @workspace/api-spec run codegen`
- JANGAN edit `lib/api-client-react/src/generated/` — akan tertimpa codegen
- DB adalah shared Supabase instance → pakai HANYA schema `sport_center`
- Anonymous booking ≠ registered customer (customers page hanya tampilkan registered)
- Setelah update `routes/index.ts` → restart API server workflow

---

## REFERENCES

- OpenAPI spec: `lib/api-spec/openapi.yaml`
- DB schema: `lib/db/src/schema/`
- Generated API client: `lib/api-client-react/src/generated/api.ts`
- Kernel (file ini): `docs/ai-kernel-v2.md`
