# Sport Center — Legacy Reference Report

Tanggal audit: 2026-06-23

## Ringkasan

| Kategori | Referensi Ditemukan | Status |
|---|---|---|
| `sport_center_bookings` (tabel) | 4 | ✅ Dihapus |
| `sport_center_facilities` (tabel) | 3 | ✅ Dihapus |
| `sport_center_memberships` (tabel) | 3 | ✅ Dihapus |
| `"sport_center_booking"` (nilai applies_to) | 9 | ✅ Diubah ke `"sport_booking"` |
| `gym_memberships` (nama tabel DB) | 1 | ✅ Renamed ke `sport_memberships` |
| `bookings` (nama tabel DB) | 1 | ✅ Renamed ke `sport_bookings` |
| `facilities` (nama tabel DB) | 1 | ✅ Renamed ke `sport_facilities` |
| `payments` (nama tabel DB) | 1 | ✅ Renamed ke `sport_payments` |
| `settings` (nama tabel DB) | 1 | ✅ Renamed ke `sport_settings` |

## Detail per File

### `artifacts/api-server/src/lib/bizportalSync.ts`
- **Sebelum**: `sport_center.sport_center_facilities`, `sport_center.sport_center_bookings`, `sport_center.sport_center_memberships`
- **Sesudah**: `sport_center.sport_facilities`, `sport_center.sport_bookings_sync`, `sport_center.sport_memberships_sync`
- **Catatan**: Sync table diberi suffix `_sync` agar tidak konflik dengan renamed main tables

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

### `artifacts/sport-center/src/pages/admin/InvoiceView.tsx`
- Line 341: Template display string diubah ke `invoice_template_sport_v1`

## DB Migration (DEV Supabase)

Dijalankan: 2026-06-23 via `scripts/src/migrate-sport-tables-dev.ts`

```
ALTER TABLE sport_center.bookings RENAME TO sport_bookings
ALTER TABLE sport_center.facilities RENAME TO sport_facilities
ALTER TABLE sport_center.payments RENAME TO sport_payments
ALTER TABLE sport_center.gym_memberships RENAME TO sport_memberships
ALTER TABLE sport_center.settings RENAME TO sport_settings
UPDATE tax_settings SET applies_to = 'sport_booking' WHERE applies_to = 'sport_center_booking'
CREATE VIEW sport_center.sport_invoices → company_invoices
CREATE VIEW sport_center.sport_invoice_items → company_invoice_items
CREATE VIEW sport_center.sport_customers → users WHERE role='customer'
```

Juga dijalankan di local heliumdb (dev API server fallback).

## PROD Status

**PROD BELUM DISENTUH.** Migration SQL tersedia di `migrations/sport-center-legacy-routing-fix.sql`.
Jalankan di PROD hanya setelah DEV valid dan approval manual.
