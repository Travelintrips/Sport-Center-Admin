# Changelog: Sport Center Table Routing Fix

**Tanggal:** 2026-06-23  
**Scope:** DEV only — PROD belum disentuh  
**Jira/Task:** TASK SPORT CENTER FRONTEND — Migrasi penuh ke tabel sport_* resmi

---

## Ringkasan

Migrasi penuh seluruh referensi tabel legacy (`sport_center_*`, `sc_*`) ke tabel resmi `sport_*`.
Ditambahkan `accounting_journal_lines` untuk double-entry bookkeeping.
Invoice diperbarui ke formula PPN 12% sesuai PMK-131/2024.

---

## Perubahan File

### lib/db/src/schema/

| File | Perubahan |
|---|---|
| `accountingJournals.ts` | `booking_id` dibuat **nullable** (untuk expense journals yang tidak punya booking_id) |
| `accountingJournalLines.ts` | **BARU** — tabel `accounting_journal_lines`: `id, journal_id, line_type, account_code, account_name, amount, description` |
| `index.ts` | Tambah export `accountingJournalLines` |

### artifacts/api-server/src/lib/

| File | Perubahan |
|---|---|
| `accounting.ts` | **Refactor total** — `createJournalEntry()` kini juga insert ke `accounting_journal_lines`; tambah fungsi `createExpenseJournalEntry()` untuk expense payments; `reverseJournalEntry()` juga post journal lines |
| `invoiceTemplate.ts` | Label `PPN 11%` → **`PPN 12%`** di HTML invoice |

### artifacts/api-server/src/routes/

| File | Perubahan |
|---|---|
| `invoices.ts` | Formula DPP dinamis: divisor sekarang `(1 + ppnRate/100)` bukan hardcoded `1.11`; PPN dihitung dari `DPP Nilai Lain × 12%` sesuai PMK-131/2024 |
| `expenses.ts` | Ganti inline journal insert dengan `createExpenseJournalEntry()` dari `accounting.ts`; import `accountingJournalsTable` dihapus |

### migrations/

| File | Perubahan |
|---|---|
| `sport-center-legacy-routing-fix.sql` | **v2.0** — Semua RENAME TABLE sekarang idempotent (wrapped dalam DO $$ block IF EXISTS); Tambah `CREATE TABLE IF NOT EXISTS accounting_journal_lines`; Tambah ALTER untuk jadikan `booking_id` nullable; Semua perubahan safe untuk re-run |

### docs/

| File | Perubahan |
|---|---|
| `sport-center-table-routing.md` | Update dengan tabel accounting baru, kode COA, alur journal, formula PPN 12% |
| `sport-center-legacy-reference-report.md` | Update status semua referensi legacy |

---

## Tabel Legacy vs Resmi (Final)

| Legacy | Resmi | Status |
|---|---|---|
| `sport_center_bookings` | `sport_bookings` | ✅ Renamed (DEV) |
| `sport_center_facilities` | `sport_facilities` | ✅ Renamed (DEV) |
| `sport_center_memberships` | `sport_memberships` | ✅ Renamed (DEV) |
| `sc_payments` | `sport_payments` | ✅ Renamed (DEV) |
| `gym_memberships` | `sport_memberships` | ✅ Renamed (DEV) |
| `bookings` | `sport_bookings` | ✅ Renamed (DEV) |
| `facilities` | `sport_facilities` | ✅ Renamed (DEV) |
| `payments` | `sport_payments` | ✅ Renamed (DEV) |
| `settings` | `sport_settings` | ✅ Renamed (DEV) |
| `applies_to='sport_center_booking'` | `applies_to='sport_booking'` | ✅ Updated |

---

## Accounting Flow (Double-Entry)

### Booking Payment Confirmed
```
accounting_journals (header):    journal_type = 'payment_confirmed'
accounting_journal_lines:
  DEBIT  1-1001  Kas/Bank                    = grandTotal
  CREDIT 4-1001  Pendapatan Sport Center      = subtotal
  CREDIT 2-1101  PPN Keluaran                 = ppnAmount
```

### Expense Paid
```
accounting_journals (header):    journal_type = 'expense_paid', booking_id = NULL
accounting_journal_lines:
  DEBIT  6-0001  Beban [Kategori]             = amount
  DEBIT  2-1201  PPN Masukan (jika ada)       = ppnAmount
  CREDIT 1-1001  Kas/Bank ([metode])          = totalAmount
```

### Booking Reversal
```
accounting_journals (header):    journal_type = 'reversal', is_reversal = true
accounting_journal_lines:
  DEBIT  4-1001  Pendapatan Sport Center      = subtotal
  DEBIT  2-1101  PPN Keluaran (jika ada)      = ppnAmount
  CREDIT 1-1001  Kas/Bank                     = grandTotal
```

---

## Invoice PPN Formula (PMK-131/2024)

**Label:** PPN 12% (bukan 11%)

```
DPP          = grandTotal / (1 + ppnRate/100)   ← dinamis, bukan hardcoded 1.11
DPP Nilai Lain = DPP × (11/12)
PPN 12%      = DPP Nilai Lain × 12%
TOTAL        = DPP + PPN
```

---

## Status DEV / PROD

| Environment | Status |
|---|---|
| DEV (Supabase DEV) | ✅ Migration SQL siap, jalankan `migrations/sport-center-legacy-routing-fix.sql` |
| PROD | ❌ **BELUM DISENTUH** — jalankan hanya setelah backup + approval manual |

---

## Cara Apply Migration di DEV

```bash
# Pastikan koneksi ke SUPABASE_DATABASE_URL_DEV (session pooler port 5432)
psql "$SUPABASE_DATABASE_URL_DEV_SESSION" -f migrations/sport-center-legacy-routing-fix.sql
```

> Catatan: Gunakan session pooler (port 5432) untuk DDL/migrations, bukan transaction pooler (6543).
