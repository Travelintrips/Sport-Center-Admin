# Sport Center — Legacy Reference Report

Tanggal audit: 2026-06-23 (v2.0 update)

## Ringkasan

| Kategori | Referensi Ditemukan | Status |
|---|---|---|
| `sport_center_bookings` (tabel) | 4 | ✅ Dihapus (DEV renamed) |
| `sport_center_facilities` (tabel) | 3 | ✅ Dihapus (DEV renamed) |
| `sport_center_memberships` (tabel) | 3 | ✅ Dihapus (DEV renamed) |
| `"sport_center_booking"` (nilai applies_to) | 9 | ✅ Diubah ke `"sport_booking"` |
| `gym_memberships` (nama tabel DB) | 1 | ✅ Renamed ke `sport_memberships` |
| `bookings` (nama tabel DB) | 1 | ✅ Renamed ke `sport_bookings` |
| `facilities` (nama tabel DB) | 1 | ✅ Renamed ke `sport_facilities` |
| `payments` (nama tabel DB) | 1 | ✅ Renamed ke `sport_payments` |
| `settings` (nama tabel DB) | 1 | ✅ Renamed ke `sport_settings` |
| `accounting_journal_lines` (tabel baru) | — | ✅ Dibuat baru (double-entry) |
| `accounting_journals.booking_id` NOT NULL | 1 | ✅ Dibuat nullable (expense support) |
| Label `PPN 11%` di invoice template | 1 | ✅ Diubah ke `PPN 12%` |
| Formula PPN hardcoded `1.11` di invoices.ts | 1 | ✅ Diubah dinamis `(1 + ppnRate/100)` |

## Audit: Tidak Ada Referensi Legacy Aktif di TypeScript

Setelah audit menyeluruh pada `artifacts/api-server/src/` dan `lib/db/src/schema/`:

- **Tidak ada** raw SQL string dengan nama tabel legacy di kode TypeScript
- **Tidak ada** import atau query yang pakai `sport_center_bookings`, `sc_payments`, dll.
- Semua route sudah menggunakan Drizzle ORM table variables yang map ke nama resmi:
  - `bookingsTable` → `sport_center.sport_bookings`
  - `facilitiesTable` → `sport_center.sport_facilities`
  - `paymentsTable` → `sport_center.sport_payments`
  - `gymMembershipsTable` → `sport_center.sport_memberships`
  - `expensesTable` → `sport_center.sport_expenses`
  - `settingsTable` → `sport_center.sport_settings`

## Detail Perubahan Kode (Update 2026-06-23)

### `lib/db/src/schema/accountingJournals.ts`
- **Sebelum**: `booking_id` NOT NULL dengan FK reference
- **Sesudah**: `booking_id` **nullable** — diperlukan untuk expense journals yang tidak memiliki booking

### `lib/db/src/schema/accountingJournalLines.ts` (BARU)
- Tabel baru `sport_center.accounting_journal_lines`
- Kolom: `id, journal_id (FK), line_type, account_code, account_name, amount, description, created_at`
- Mendukung double-entry bookkeeping (setiap jurnal punya baris debit+kredit terpisah)

### `artifacts/api-server/src/lib/accounting.ts`
- `createJournalEntry()` — kini juga insert ke `accounting_journal_lines` (debit Kas/Bank, credit Pendapatan + PPN Keluaran)
- `createExpenseJournalEntry()` — fungsi baru untuk expense payments (debit Beban + PPN Masukan, credit Kas/Bank)
- `reverseJournalEntry()` — kini juga post journal lines untuk reversal entries

### `artifacts/api-server/src/lib/invoiceTemplate.ts`
- Line 567: `PPN 11%` → **`PPN 12%`**

### `artifacts/api-server/src/routes/invoices.ts`
- Formula DPP: `grandTotal / 1.11` → **`grandTotal / (1 + ppnRate/100)`** (dinamis)
- Formula PPN: `dpp * 0.11` → **`dppNilaiLain * 0.12`** (sesuai PMK-131/2024)
- Semua 4 field invoice ditampilkan: DPP, DPP Nilai Lain, PPN 12%, TOTAL

### `artifacts/api-server/src/routes/expenses.ts`
- Ganti inline `db.insert(accountingJournalsTable)` dengan `createExpenseJournalEntry()`
- Import `accountingJournalsTable` dihapus (sekarang hanya via `accounting.ts`)
- Expense paid kini juga post ke `accounting_journal_lines`

## Riwayat Perubahan Sebelumnya (v1.0)

### `artifacts/api-server/src/lib/bizportalSync.ts`
- **Sebelum**: `sport_center.sport_center_facilities`, `sport_center.sport_center_bookings`, `sport_center.sport_center_memberships`
- **Sesudah**: `sport_center.sport_facilities`, `sport_center.sport_bookings_sync`, `sport_center.sport_memberships_sync`

### `lib/db/src/schema/bookings.ts`
- **Sebelum**: `scSchema.table("bookings", ...)`
- **Sesudah**: `scSchema.table("sport_bookings", ...)`

### `lib/db/src/schema/facilities.ts`
- **Sebelum**: `scSchema.table("facilities", ...)`
- **Sesudah**: `scSchema.table("sport_facilities", ...)`

### `lib/db/src/schema/payments.ts`
- **Sebelum**: `scSchema.table("payments", ...)`
- **Sesudah**: `scSchema.table("sport_payments", ...)`

### `lib/db/src/schema/memberships.ts`
- **Sebelum**: `scSchema.table("gym_memberships", ...)`
- **Sesudah**: `scSchema.table("sport_memberships", ...)`

### `lib/db/src/schema/settings.ts`
- **Sebelum**: `scSchema.table("settings", ...)`
- **Sesudah**: `scSchema.table("sport_settings", ...)`

### `lib/db/src/schema/taxSettings.ts`
- **Sebelum**: `.default("sport_center_booking")`
- **Sesudah**: `.default("sport_booking")`

### `artifacts/api-server/src/lib/tax.ts`
- Line 24: default `appliesTo = "sport_center_booking"` → `"sport_booking"`
- Line 134: WHERE `applies_to = "sport_center_booking"` → `"sport_booking"`

### `artifacts/api-server/src/routes/taxConfig.ts`
- Lines 43, 47, 89: `"sport_center_booking"` → `"sport_booking"` (3 referensi)

### `artifacts/api-server/src/routes/invoices.ts`
- Line 71: `appliesTo = "sport_center_booking"` → `"sport_booking"`

### `artifacts/api-server/src/routes/bookings.ts`
- Lines 397, 716: `calculateTax(..., "sport_center_booking", ...)` → `"sport_booking"`

### `artifacts/api-server/src/routes/whatsapp.ts`
- Lines 668, 2518: `calculateTax(..., "sport_center_booking", ...)` → `"sport_booking"`

### `artifacts/api-server/src/index.ts`
- Line 410: `DEFAULT 'sport_center_booking'` → `DEFAULT 'sport_booking'`
- Line 474: INSERT seed value `'sport_center_booking'` → `'sport_booking'`

## DB Migration Status

| Environment | Status | Perintah |
|---|---|---|
| DEV (Supabase DEV) | ✅ SQL siap | `psql $SUPABASE_DATABASE_URL_DEV_SESSION -f migrations/sport-center-legacy-routing-fix.sql` |
| PROD | ❌ **BELUM DISENTUH** | Tunggu approval manual setelah DEV valid |
