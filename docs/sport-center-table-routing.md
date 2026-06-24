# Sport Center — Table Routing (sport_* Official Schema)

Tanggal update: 2026-06-23 (v2.0 — PPN 12%, double-entry journal lines)

## Tabel Resmi (sport_center schema)

| Tabel Resmi | Drizzle Table Object | Kolom Utama |
|---|---|---|
| `sport_bookings` | `bookingsTable` | id, order_number, customer_id, facility_id, booking_date, start_time, end_time, duration_hours, total_price, status, payer_type, billing_status, ppn_rate, ppn_amount, grand_total |
| `sport_facilities` | `facilitiesTable` | id, name, category, description, price_per_hour, open_time, close_time, min_duration, max_duration, booking_mode, is_active |
| `sport_payments` | `paymentsTable` | id, booking_id, amount, proof_url, payment_method, payment_type (dp/pelunasan/full_payment), status, confirmed_at |
| `sport_memberships` | `gymMembershipsTable` | id, name, email, phone, start_date, end_date, months, total_price, status, payment_method, payment_proof_url |
| `sport_settings` | `settingsTable` | id, center_name, address, phone, whatsapp, email, open_hour, close_hour, bank_name, bank_account, fonnte_token, admin_wa_phones |
| `sport_expenses` | `expensesTable` | id, expense_no, expense_date, category, description, amount, ppn_amount, total_amount, payment_status, journal_id |
| `company_invoices` | `companyInvoicesTable` | id, invoice_number, company_id, period_start, period_end, subtotal, ppn_rate, ppn_amount, grand_total, status |
| `company_invoice_items` | `companyInvoiceItemsTable` | id, invoice_id, booking_id, description, amount |
| `sport_customers` | `usersTable` (view) | id, name, email, phone, role='customer' |

## Tabel Accounting (Double-Entry)

| Tabel | Drizzle Table Object | Deskripsi |
|---|---|---|
| `accounting_journals` | `accountingJournalsTable` | Header jurnal (1 baris per transaksi) |
| `accounting_journal_lines` | `accountingJournalLinesTable` | Baris debit/kredit (double-entry) |

### Kode Akun COA Baku

| Kode | Nama Akun | Tipe |
|---|---|---|
| `1-1001` | Kas/Bank | Aset |
| `2-1101` | PPN Keluaran | Kewajiban |
| `2-1201` | PPN Masukan | Aset |
| `4-1001` | Pendapatan Sport Center | Pendapatan |
| `6-0001` | Beban Operasional (Expense Category) | Beban |

### Alur Accounting Journal per Transaksi

#### Booking — Payment Confirmed
```
DEBIT  1-1001  Kas/Bank                   = grandTotal
CREDIT 4-1001  Pendapatan Sport Center    = subtotal
CREDIT 2-1101  PPN Keluaran               = ppnAmount
```

#### Expense — Paid
```
DEBIT  6-0001  Beban [kategori]           = amount
DEBIT  2-1201  PPN Masukan (jika ada)     = ppnAmount
CREDIT 1-1001  Kas/Bank ([metode])        = totalAmount
```

#### Booking — Reversal (Refund/Cancel)
```
DEBIT  4-1001  Pendapatan Sport Center    = subtotal
DEBIT  2-1101  PPN Keluaran (jika ada)    = ppnAmount
CREDIT 1-1001  Kas/Bank                   = grandTotal
```

## Views (alias read-only)

| View | Source | Keterangan |
|---|---|---|
| `sport_invoices` | `company_invoices` | Read-only alias untuk reporting |
| `sport_invoice_items` | `company_invoice_items` | Read-only alias untuk reporting |
| `sport_customers` | `users WHERE role='customer'` | Daftar customer terdaftar |

## Tabel Sync BizPortal (dibuat otomatis oleh bizportalSync.ts)

| Tabel Sync | Fungsi |
|---|---|
| `sport_facilities` | Sync fasilitas ke BizPortal (id=sc-N) |
| `sport_bookings_sync` | Snapshot booking untuk external portal |
| `sport_memberships_sync` | Snapshot membership untuk external portal |

## Tabel Tidak Berubah

Tabel berikut tidak menggunakan prefix legacy dan tidak diubah:

- `accounting_journals`, `accounting_journal_lines`
- `tax_settings`, `tax_transactions`
- `audit_logs`, `booking_history`, `booking_cancellations`
- `wa_action_tokens`, `wa_booking_sessions`
- `bank_mutations`, `bank_reconciliation_*`
- `company_invoices`, `company_invoice_items`, `company_verifications`
- `blocked_schedules`, `pricing_rules`, `promos`, `users`
- `facility_images`, `maintenance_schedules`, `reschedule_requests`

## Nilai applies_to di tax_settings

| Sebelum | Sesudah |
|---|---|
| `sport_center_booking` | `sport_booking` |

## Formula PPN Invoice (PMK-131/2024)

Label invoice: **PPN 12%** (bukan 11%)

```
ppnRate      = dari booking.ppn_rate ATAU tax_settings.tax_rate (default 12)
DPP          = grandTotal / (1 + ppnRate/100)
DPP Nilai Lain = DPP × (11/12)          ← dasar pengenaan PMK-131
PPN 12%      = DPP Nilai Lain × 12%     ← PPN terutang
TOTAL        = DPP + PPN
```

Semua fungsi `calculateTax()` dan query `taxConfig` sudah diupdate ke `"sport_booking"`.
