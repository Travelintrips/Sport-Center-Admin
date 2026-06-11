# ACCOUNTING AUDIT REPORT
## Sport Center Soekarno-Hatta — Audit Menyeluruh Alur Accounting
**Tanggal Audit:** 11 Juni 2026  
**Auditor:** Replit Agent  
**Scope:** Seluruh alur keuangan — pembayaran masuk, pembayaran keluar, jurnal, refund, corporate billing, membership, tenant, reschedule, dan extra time

---

## RINGKASAN EKSEKUTIF

| Kategori | Status |
|---|---|
| Payment Record (booking personal) | ✅ Ada |
| Payment Record (booking WA) | ✅ Ada |
| Payment Record (corporate billing) | ⚠️ Parsial |
| Payment Record (gym membership) | ❌ Tidak di tabel `payments` |
| Payment Record (tenant) | ✅ Ada (`tenant_payments`) |
| Audit Log (booking) | ⚠️ Parsial |
| Audit Log (payment) | ⚠️ Parsial |
| Audit Log (membership) | ❌ Tidak ada |
| Jurnal Accounting (double-entry) | ❌ **TIDAK ADA SAMA SEKALI** |
| Expense / Pembayaran Keluar | ❌ **TIDAK ADA SAMA SEKALI** |
| Auto-expiry Membership | ❌ Tidak ada |
| Reschedule Fee sebagai Revenue | ❌ Tidak ditagih |
| Extension Fee sebagai Payment Record | ❌ Tidak ada |
| Refund Reversal Journal | ❌ Tidak ada |
| PPN Tracking dalam Ledger | ❌ Tidak ada |

---

## BAGIAN 1 — APA YANG SUDAH AMAN

### ✅ 1.1 Alur Booking Personal (Pembayaran Masuk)
- Booking dibuat dengan status `pending_payment`
- Upload bukti transfer → status `waiting_confirmation`
- Admin konfirmasi → status `confirmed`, payment record diupdate
- Booking history tercatat di setiap state change
- Audit log tersedia pada payment confirmation (`update_payment`)
- WhatsApp notification dikirim di setiap tahap
- Bizportal sync aktif

### ✅ 1.2 Alur Booking via WhatsApp
- Booking dibuat via webhook Fonnte
- Token-based action untuk upload proof, approve/reject, check-in, finish
- Payment record dibuat di `payments` table dengan status `pending` → `confirmed`
- Audit log tersedia: `wa_booking_created`, `wa_proof_uploaded`, `wa_approve_payment`, `wa_reject_payment`, `wa_checkin`, `wa_finish`
- Booking history tercatat

### ✅ 1.3 Alur Corporate Billing (Operasional)
- Booking company auto-confirmed tanpa payment upfront
- `billingStatus` ditag: `unbilled` → `billed` → `paid`
- Invoice generation dengan PPN 11% dihitung otomatis
- Invoice number unik dengan format `INV-YYYYMM-XXXX`
- Saat invoice dibayar: semua booking linked → `completed`

### ✅ 1.4 Alur Tenant Payment
- `tenant_bookings` dan `tenant_payments` tabel terpisah
- Status payment: `pending` → `verified`/`rejected`
- Bukti bayar disimpan sebagai URL

### ✅ 1.5 Alur Pembatalan
- Status booking → `cancelled`
- Record di `booking_cancellations` dibuat dengan `refund_amount` dan `refund_status`
- Booking history tercatat
- Audit log tersedia: `cancel_booking`
- Slot waktu dibebaskan (konflik check mengecualikan status inactive)

### ✅ 1.6 Extra Time / Booking Extension
- Extension request disetujui → `endTime`, `durationHours`, dan `totalPrice` diupdate
- Booking history mencatat tambahan jam dan nominal
- Audit log tersedia: `extension_approve`, `extend_direct`

### ✅ 1.7 Schema Keuangan Dasar
- Tabel `payments`: booking_id, amount, proof_url, status, confirmed_at
- Tabel `company_invoices`: invoice_number, total_amount, ppn_amount, grand_total
- Tabel `booking_cancellations`: refund_amount, refund_status
- Tabel `booking_extension_requests`: additional_price
- Discount tracking: `discount_amount`, `ap_discount_amount`, `base_price`

---

## BAGIAN 2 — APA YANG BELUM AMAN

### ❌ KRITIKAL

---

#### **[C-01] TIDAK ADA SISTEM JURNAL ACCOUNTING (DOUBLE-ENTRY)**
**Risiko: KRITIS**

Seluruh aplikasi tidak memiliki tabel jurnal, ledger, atau Chart of Accounts. Tidak ada satu pun `debit`/`credit` entry yang dibuat untuk transaksi apapun.

**Kondisi saat ini:**
- Tidak ada tabel `journals`, `journal_entries`, `ledger`, atau `accounts`
- Revenue dihitung on-the-fly dari `SUM(total_price)` di tabel bookings
- Tidak ada neraca (balance sheet), laporan laba rugi berbasis akrual, atau trial balance

**Yang seharusnya ada:**

| Transaksi | Debit | Kredit |
|---|---|---|
| Booking dikonfirmasi (cash) | Cash / Bank | Pendapatan Sewa |
| Booking corporate (AR) | Piutang Usaha (AR) | Pendapatan Sewa |
| Invoice corporate dibayar | Cash / Bank | Piutang Usaha (AR) |
| Refund diberikan | Pendapatan Sewa | Cash / Bank |
| Expense operasional | Beban Operasional | Cash / Bank |
| PPN Keluaran (booking ber-PPN) | Cash / Bank | Hutang PPN |
| PPN Masukan (expense ber-PPN) | PPN Masukan | Cash / Bank |

**File yang perlu dibuat:** `lib/db/src/schema/journals.ts`, `lib/db/src/schema/accounts.ts`

---

#### **[C-02] TIDAK ADA MODUL EXPENSE / PEMBAYARAN KELUAR**
**Risiko: KRITIS**

Tidak ada tabel, route, atau halaman UI untuk mencatat:
- Biaya operasional harian
- Biaya maintenance fasilitas
- Pembayaran vendor/supplier
- Pembelian perlengkapan sport center
- Kasbon / reimbursement karyawan

**Kondisi saat ini:**
- Tabel `maintenance_schedules` hanya menyimpan jadwal (alasan, waktu), **tidak ada kolom cost**
- Tidak ada tabel `expenses`, `vendors`, `purchase_orders`, atau `cash_disbursements`
- Tidak ada halaman admin untuk input pengeluaran

**Dampak:** Laporan keuangan hanya mencatat sisi pemasukan. Laba/rugi aktual tidak bisa dihitung.

**File yang perlu dibuat:** `lib/db/src/schema/expenses.ts`, route `expenses.ts`, halaman admin Expenses

---

#### **[C-03] GYM MEMBERSHIP: TIDAK ADA PAYMENT RECORD DI TABEL `payments`**
**Risiko: KRITIS**

Payment data membership (method, proof URL, total) **disimpan langsung di tabel `gym_memberships`**, bukan di tabel `payments` yang terpusat.

**Dampak:**
- Revenue dari membership tidak masuk ke laporan keuangan utama (yang bersumber dari `payments`)
- Tidak bisa dilakukan rekonsiliasi terpusat antara booking revenue dan membership revenue
- Jika ada dispute payment, tidak ada payment record terpisah untuk direferensikan

**File bermasalah:** `artifacts/api-server/src/routes/memberships.ts`, `lib/db/src/schema/memberships.ts`

---

#### **[C-04] REFUND TIDAK MEMBALIK JURNAL / REVENUE**
**Risiko: KRITIS**

Ketika booking direfund:
- Status booking diubah ke `refunded` oleh admin secara manual
- `booking_cancellations.refundStatus` ada tapi hanya diinisialisasi sebagai `none` dan tidak diupdate secara otomatis
- **Tidak ada payment record negatif/reversal yang dibuat**
- **Tidak ada jurnal pembalik** (Debit Pendapatan, Kredit Cash/Bank)

**Kondisi saat ini di `POST /bookings/:id/cancel`:**
```
bookingCancellations.refundStatus = "none"  // tidak pernah diubah ke "paid"
// Tidak ada: payments.insert({amount: -X, type: 'refund'})
// Tidak ada: journal reversal
```

**File bermasalah:** `artifacts/api-server/src/routes/cancellations.ts`, `artifacts/api-server/src/routes/bookings.ts`

---

#### **[C-05] EXTENSION FEE TIDAK MEMBUAT PAYMENT RECORD BARU**
**Risiko: TINGGI**

Ketika extension disetujui, `totalPrice` pada booking diincrement. Namun:
- **Tidak ada payment record baru** yang dibuat untuk selisih tambahan (`additionalPrice`)
- Customer tidak diminta bayar / upload bukti untuk tambahan waktu
- Revenue dari extra time masuk ke total booking tapi tidak terlacak sebagai transaksi terpisah

**File bermasalah:** `artifacts/api-server/src/routes/bookingExtensions.ts`

---

#### **[C-06] RESCHEDULE FEE TIDAK DITAGIHKAN**
**Risiko: TINGGI**

Reschedule request diapprove tanpa ada mekanisme pengisian fee. Padahal:
- Tabel `reschedule_requests` tidak memiliki kolom `fee_amount`, `fee_status`, atau `fee_payment_id`
- Route `PATCH /reschedule-requests/:id` hanya mengupdate booking date, tidak ada pengecekan fee
- Tidak ada payment record, tidak ada revenue untuk reschedule

**File bermasalah:** `artifacts/api-server/src/routes/reschedule.ts`, `lib/db/src/schema/reschedule.ts`

---

### ⚠️ WARNING

---

#### **[W-01] AUDIT LOG TIDAK KONSISTEN**
**Risiko: SEDANG**

| Route / Aksi | Audit Log |
|---|---|
| `POST /payments` (upload proof) | ❌ Tidak ada |
| `POST /bookings` (create booking) | ❌ Tidak ada |
| `POST /company-invoices/generate` | ❌ Tidak ada |
| `PATCH /company-invoices/:id` (mark paid) | ❌ Tidak ada |
| Membership: semua aksi | ❌ Tidak ada sama sekali |
| Tenant payment: semua aksi | ❌ Tidak ada |
| `PATCH /payments/:id` (konfirmasi) | ✅ Ada |
| `POST /bookings/:id/cancel` | ✅ Ada |

**File bermasalah:** `payments.ts`, `bookings.ts`, `companyInvoices.ts`, `memberships.ts`, `tenants.ts`

---

#### **[W-02] CORPORATE BILLING: TIDAK ADA PAYMENT RECORD SAAT INVOICE DIBAYAR**
**Risiko: SEDANG**

Ketika admin mark invoice sebagai `paid`:
- Invoice status → `paid`
- Booking status → `completed`
- **Tidak ada record di tabel `payments`** untuk pembayaran invoice
- Tidak ada `paid_by` atau `payment_proof_url` pada `company_invoices`

**File bermasalah:** `artifacts/api-server/src/routes/companyInvoices.ts`

---

#### **[W-03] GYM MEMBERSHIP: TIDAK ADA AUDIT LOG**
**Risiko: SEDANG**

Seluruh route di `memberships.ts` tidak memanggil `logAudit`. Ini mencakup:
- Membuat membership baru
- Upload payment proof
- Admin approve/reject membership
- Update status membership

**File bermasalah:** `artifacts/api-server/src/routes/memberships.ts`

---

#### **[W-04] GYM MEMBERSHIP: TIDAK ADA AUTO-EXPIRY**
**Risiko: SEDANG**

Scheduler background (`scheduler.ts`) hanya menghandle auto-expire booking personal yang `pending_payment` melewati deadline. **Tidak ada scheduler** yang:
- Mengubah membership `active` → `expired` saat `endDate` terlewati
- Mengirimkan notifikasi renewal sebelum expired

**File bermasalah:** `artifacts/api-server/src/lib/scheduler.ts`

---

#### **[W-05] PPN HANYA ADA DI COMPANY INVOICE, TIDAK DI BOOKING PERSONAL**
**Risiko: SEDANG**

PPN 11% dihitung saat generate company invoice. Namun:
- Booking personal tidak ada field `ppn_amount`
- Tidak ada konfigurasi apakah booking personal dikenakan PPN
- Tidak ada tabel `tax_transactions` atau tracking PPN Keluaran/Masukan

**File bermasalah:** `lib/db/src/schema/bookings.ts`, `artifacts/api-server/src/routes/companyInvoices.ts`

---

#### **[W-06] TENANT PAYMENT: TIDAK ADA AUDIT LOG**
**Risiko: SEDANG**

Route tenant payment tidak memanggil `logAudit` untuk aksi:
- Tenant upload payment proof
- Admin verify/reject payment

---

#### **[W-07] REFUND STATUS TIDAK PERNAH DIUPDATE**
**Risiko: SEDANG**

Di `booking_cancellations`, field `refundStatus` diinisialisasi sebagai `none` dan **tidak ada mekanisme** untuk mengubahnya menjadi `processing` atau `paid`. Admin tidak bisa mencatat bahwa refund telah ditransfer ke customer.

**File bermasalah:** `artifacts/api-server/src/routes/cancellations.ts`, `artifacts/api-server/src/routes/bookings.ts`

---

#### **[W-08] MAINTENANCE: TIDAK ADA COST TRACKING**
**Risiko: RENDAH-SEDANG**

Tabel `maintenance_schedules` hanya menyimpan jadwal dan alasan. Tidak ada:
- `estimated_cost`, `actual_cost`
- Link ke expense/vendor
- Status pembayaran maintenance

---

#### **[W-09] LAPORAN REVENUE TIDAK MENCAKUP SEMUA SUMBER**
**Risiko: SEDANG**

Route `reports.ts` menghitung revenue dari `bookings.total_price`. Namun:
- Revenue dari **gym membership** tidak termasuk
- Revenue dari **tenant booking** tidak termasuk
- Extra time / extension sebagai line item terpisah tidak terlihat

---

## BAGIAN 3 — GAP ACCOUNTING (CHECKLIST AUDIT)

| No | Gap | Status |
|---|---|---|
| 1 | Booking paid tapi tidak ada jurnal | ❌ **Ada gap** — tidak ada jurnal sama sekali |
| 2 | Payment success tapi status booking masih pending | ✅ Tidak ada — flow sudah benar |
| 3 | Invoice paid tapi AR belum tertutup | ⚠️ **Ada gap** — tidak ada AR journal, status flag saja |
| 4 | Refund tidak membalik revenue/cash | ❌ **Ada gap** — tidak ada reversal |
| 5 | Corporate billing unbilled/billed/paid tidak sinkron | ✅ Sinkron via bulk update |
| 6 | Reschedule fee tidak masuk revenue | ❌ **Ada gap** — tidak ada fee system |
| 7 | Extra time tidak masuk tagihan | ❌ **Ada gap** — totalPrice naik tapi tidak ada payment record baru |
| 8 | Payment keluar tidak masuk expense | ❌ **Ada gap** — tidak ada modul expense |
| 9 | Expense approved tapi belum posted | ❌ N/A — expense tidak ada |
| 10 | Duplicate journal | ✅ N/A — tidak ada journal |
| 11 | Journal tidak balance debit/credit | ❌ **Ada gap** — tidak ada journal |
| 12 | Nomor invoice/payment/journal duplikat | ✅ Invoice number unik, order_number unik |
| 13 | Transaksi tanpa audit log | ❌ **Ada gap** — banyak transaksi tanpa audit log |

---

## BAGIAN 4 — TABEL TRANSAKSI BERMASALAH

| Tipe Transaksi | Sumber | Payment Record | Jurnal | Audit Log | Gap Utama |
|---|---|---|---|---|---|
| Booking personal | `bookings` + `payments` | ✅ | ❌ | ⚠️ Parsial | No journal |
| Booking WA | `bookings` + `payments` | ✅ | ❌ | ✅ | No journal |
| Booking corporate | `bookings` + `company_invoices` | ❌ (invoice saja) | ❌ | ❌ | No payment record saat bayar, no journal |
| Gym membership | `gym_memberships` | ❌ (embedded) | ❌ | ❌ | Payment not in payments table, no audit log |
| Tenant booking | `tenant_bookings` + `tenant_payments` | ✅ | ❌ | ❌ | No journal, no audit log |
| Extension fee | `booking_extension_requests` | ❌ | ❌ | ✅ | No payment record for delta |
| Reschedule fee | `reschedule_requests` | ❌ | ❌ | ✅ | Fee tidak diimplementasi |
| Refund | `booking_cancellations` | ❌ (reversal) | ❌ | ✅ | No reversal, refundStatus stuck at "none" |
| Expense operasional | — | ❌ | ❌ | ❌ | Modul tidak ada |
| Maintenance cost | `maintenance_schedules` | ❌ | ❌ | ✅ | Cost tidak ditracak |

---

## BAGIAN 5 — FILE YANG PERLU DIPERBAIKI

### Schema (lib/db/src/schema/)
| File | Aksi |
|---|---|
| `journals.ts` | **BUAT BARU** — tabel jurnal double-entry |
| `accounts.ts` | **BUAT BARU** — Chart of Accounts |
| `expenses.ts` | **BUAT BARU** — tabel expense / pengeluaran |
| `memberships.ts` | Tambah FK ke `payments`, hapus embedded payment fields |
| `reschedule.ts` | Tambah `fee_amount`, `fee_status`, `fee_payment_id` |
| `cancellations.ts` | Perbaiki flow `refundStatus` update |
| `bookings.ts` | Tambah `ppn_amount` untuk booking personal |
| `maintenance.ts` | Tambah `estimated_cost`, `actual_cost` |
| `companyInvoices.ts` | Tambah `payment_proof_url`, `paid_by` |

### Routes (artifacts/api-server/src/routes/)
| File | Aksi |
|---|---|
| `payments.ts` | Tambah `logAudit` pada POST (upload proof) |
| `bookings.ts` | Tambah `logAudit` pada POST (create), fix refund flow |
| `companyInvoices.ts` | Tambah `logAudit`, buat payment record saat `paid` |
| `memberships.ts` | Tambah `logAudit` di semua aksi, create payment record |
| `cancellations.ts` | Implementasi refund reversal, update `refundStatus` |
| `bookingExtensions.ts` | Buat payment record untuk `additionalPrice` |
| `reschedule.ts` | Implementasi reschedule fee (jika kebijakan bisnis berlaku) |
| `expenses.ts` | **BUAT BARU** — CRUD expense dengan approval flow |

### Lib/Services
| File | Aksi |
|---|---|
| `scheduler.ts` | Tambah job auto-expire gym membership |
| `journalService.ts` | **BUAT BARU** — fungsi posting jurnal debit/kredit |

---

## BAGIAN 6 — RISIKO ACCOUNTING

| Risiko | Level | Penjelasan |
|---|---|---|
| Laporan keuangan tidak akurat | 🔴 KRITIS | Revenue hanya dari booking, tanpa membership dan tenant |
| Tidak bisa audit trail keuangan | 🔴 KRITIS | Tidak ada jurnal → tidak bisa rekonsiliasi |
| Refund tidak tercatat di laporan | 🔴 KRITIS | Cash keluar tidak tercatat |
| Expense tidak tercatat | 🔴 KRITIS | Laba/rugi tidak bisa dihitung |
| AR corporate tidak ter-manage | 🟡 TINGGI | Tidak ada debit AR saat booking, kredit saat lunas |
| Membership revenue bocor | 🟡 TINGGI | Tidak masuk rekap payment utama |
| Extension / reschedule revenue bocor | 🟡 TINGGI | Tidak ada payment record terpisah |
| PPN tidak termonitor | 🟡 TINGGI | Kewajiban pajak tidak terlacak per transaksi |
| Audit trail tidak lengkap | 🟠 SEDANG | Banyak aksi finansial tanpa log |
| Membership tidak auto-expired | 🟠 SEDANG | Data aktif/tidak aktif tidak akurat |

---

## BAGIAN 7 — FASE IMPLEMENTASI PERBAIKAN

### FASE 1 — Audit Log & Quick Wins (Prioritas Tinggi, ~1–2 hari)
**Tidak ada perubahan schema, hanya tambah `logAudit` calls**

1. `POST /payments` — tambah audit log upload proof
2. `POST /bookings` — tambah audit log create booking
3. `POST /company-invoices/generate` — tambah audit log
4. `PATCH /company-invoices/:id` — tambah audit log
5. Semua route `memberships.ts` — tambah audit log
6. Semua route `tenants.ts` / `tenantPayments.ts` — tambah audit log
7. Scheduler: tambah auto-expire gym membership

**Risiko implementasi: SANGAT RENDAH**

---

### FASE 2 — Perbaikan Refund & Extension Payment Flow (~2–3 hari)

1. `booking_cancellations` — implementasi update `refundStatus` (tambah endpoint `PATCH /bookings/:id/refund`)
2. `bookingExtensions` — buat payment record terpisah untuk `additionalPrice` (bisa `pending_payment` jika belum dibayar)
3. `gym_memberships` — buat payment record di tabel `payments` saat membership dibuat, hapus embedded payment fields
4. `company_invoices` — tambah field `payment_proof_url` dan buat payment record saat mark `paid`

**Risiko implementasi: RENDAH-SEDANG** (ada schema migration)

---

### FASE 3 — Modul Expense & Pembayaran Keluar (~3–5 hari)

1. Buat schema `expenses` (kategori, jumlah, tanggal, bukti, status approval, PPN masukan)
2. Buat route CRUD `expenses.ts` dengan approval flow (pending → approved → paid)
3. Buat halaman admin Expense Management
4. Tambah expense ke laporan keuangan dashboard
5. `maintenance_schedules` — tambah kolom `estimated_cost`, `actual_cost`, link ke expense

**Risiko implementasi: SEDANG**

---

### FASE 4 — Jurnal Double-Entry Accounting (~5–7 hari)

1. Buat `accounts` table (Chart of Accounts: Cash, AR, Revenue, Expense, PPN Keluaran, PPN Masukan)
2. Buat `journal_entries` table (journal_id, account_id, debit, credit, reference_type, reference_id)
3. Buat `journalService.ts` dengan fungsi:
   - `postBookingPayment(bookingId)` — Debit Cash, Credit Revenue
   - `postCompanyAR(bookingId)` — Debit AR, Credit Revenue
   - `postARSettlement(invoiceId)` — Debit Cash, Credit AR
   - `postRefund(cancellationId)` — Debit Revenue, Credit Cash
   - `postExpense(expenseId)` — Debit Expense, Credit Cash
   - `postPPN(transactionId, type)` — PPN Keluaran/Masukan
4. Integrasikan ke semua route yang ada
5. Buat halaman Laporan Keuangan (Neraca, Laba Rugi, Arus Kas)

**Risiko implementasi: TINGGI** (perubahan menyeluruh)

---

### FASE 5 — PPN & Reschedule Fee (~2–3 hari)

1. Buat konfigurasi PPN per tipe transaksi (booking personal, membership, tenant)
2. Tambah `ppn_amount` ke `bookings` untuk personal
3. Implementasi reschedule fee berdasarkan kebijakan bisnis (misal: Rp 25.000 per reschedule)
4. Buat tabel `tax_transactions` untuk tracking SPT

---

## LAMPIRAN: REFERENSI FILE

```
lib/db/src/schema/
├── bookings.ts          — status, billing_status, payer_type
├── payments.ts          — booking_id, amount, status
├── company_invoices.ts  — ppn_amount, grand_total, status
├── memberships.ts       — embedded payment (masalah)
├── cancellations.ts     — refund_amount, refund_status (partial)
├── tenantPayments.ts    — status: pending/verified/rejected
├── bookingExtensions.ts — additional_price
├── reschedule.ts        — tidak ada fee fields
└── maintenance.ts       — tidak ada cost fields

artifacts/api-server/src/routes/
├── payments.ts          — upload proof (no audit), confirm (ada audit)
├── bookings.ts          — create (no audit), refund (manual)
├── companyInvoices.ts   — generate (no audit), mark paid (no audit)
├── memberships.ts       — semua aksi tanpa audit log
├── cancellations.ts     — ada audit, tapi refund status stuck
├── bookingExtensions.ts — ada audit, tapi no payment record
├── reschedule.ts        — ada audit, tapi no fee system
└── whatsapp.ts          — audit log lengkap ✅

artifacts/api-server/src/lib/
├── auditLog.ts          — utility tersedia, tinggal dipanggil
└── scheduler.ts         — hanya booking expiry, membership tidak ada
```

---

*Laporan ini dibuat berdasarkan audit statis terhadap source code. Tidak ada perubahan kode yang dilakukan.*
