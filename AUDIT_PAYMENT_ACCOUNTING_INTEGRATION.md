# Audit Payment → Accounting dan Kontrak Integrasi Lintas Project

**Project:** Sport Center  
**Tanggal audit:** 2026-08-08  
**Ruang lingkup:** lifecycle booking/payment, konfirmasi melalui web/admin/WhatsApp/Paylabs, sinkronisasi BizPortal dan bank, jurnal internal, public accounting, PPN, idempotensi, serta batas kepemilikan data antarproject.

## 1. Tujuan dan batasan

Dokumen ini menjadi bahan audit dan kontrak teknis sebelum project lain berbagi database, accounting, bank reconciliation, payment provider, atau scheduler dengan Sport Center.

Audit dilakukan melalui:

- review source code route dan library accounting/payment;
- review schema serta constraint yang tersedia;
- audit read-only database development;
- penelusuran kasus nyata `SC-0016`.

Audit ini **tidak** mengubah transaksi, melakukan reversal, atau memperbaiki data. Kesimpulan production harus tetap dikonfirmasi terhadap database production dan log deployment yang sesuai.

## 2. Kesimpulan eksekutif

### Status keseluruhan: HIGH RISK untuk integrasi langsung dengan project lain

Arsitektur saat ini sudah memiliki beberapa perlindungan yang benar:

- state payment diklaim secara atomic saat konfirmasi melalui `PATCH /payments/:id`;
- Paylabs menyimpan hubungan `merchant_trade_no → booking_id` sebelum memanggil provider;
- mirror payment ke BizPortal menggunakan `payment_number` berbasis payment ID;
- QRIS diarahkan ke akun Bank Mandiri yang benar;
- jurnal internal memakai `payment_id` sebagai kunci idempotensi **jika payment ID benar-benar diteruskan**;
- accounting public menggunakan correlation ID per payment **jika payment ID tersedia**.

Namun, sistem belum aman untuk dipakai bersama oleh beberapa project karena kontrol penting masih bergantung pada:

1. pemanggil route yang benar;
2. proses memory di satu instance server;
3. convention string seperti `source`, `ref`, dan `payment_number`;
4. `SELECT` sebelum `INSERT`, bukan unique constraint database;
5. fire-and-forget async tanpa outbox durable;
6. pemisahan schema yang belum sekaligus menjadi boundary ownership.

Kasus nyata `SC-0016` membuktikan dampaknya: **satu payment ID 29 sebesar Rp100.000 menghasilkan dua jurnal internal**, keduanya dengan `payment_id = NULL`. Jurnal pertama benar, jurnal kedua salah nominal dan membuat saldo akuntansi terduplikasi.

## 3. Peta alur saat ini

```text
Customer / Admin / WhatsApp / Paylabs
                 |
                 v
       sport_center.sport_bookings
                 |
                 v
       sport_center.sport_payments
                 |
        +--------+---------+
        |                  |
        v                  v
 Internal journal      Public mirror
 sport_center.*        public.sport_payments
        |                  |
        v                  v
 journal lines       public.accounting_entries
                         |
                         v
                  public GL lines + tax

Confirmed payment juga dapat membuat:
  - sport_center.bank_mutations
  - bank_journal_entries
  - BizPortal payment mirror
  - tax_transactions / gl_tax_lines
```

### Source of truth yang harus dipertahankan

| Domain | Source of truth | Project lain boleh melakukan |
|---|---|---|
| Booking dan jadwal | `sport_center.sport_bookings` | Read melalui API/event; tidak boleh reverse-write |
| Payment operasional | `sport_center.sport_payments` | Read atau membuat intent melalui contract resmi |
| Paylabs relation | `sport_center.paylabs_transactions` | Hanya payment owner/provider adapter |
| Jurnal internal Sport Center | `sport_center.accounting_journals` dan lines | Hanya accounting owner |
| Accounting bersama | `public.accounting_entries` dan lines | Hanya central accounting service |
| Bank mutation | `sport_center.bank_mutations` / public mirror sesuai owner | Tidak boleh membuat synthetic mutation tanpa namespace |
| Reporting mirror | `public.sport_payments`, `sport_bookings` | Sinkronisasi satu arah dan replayable |

## 4. Detail lifecycle payment

### 4.1 Upload bukti pembayaran

Lokasi utama: `artifacts/api-server/src/routes/payments.ts:217-451`.

Flow:

1. Booking dibaca dan status harus `pending_payment`.
2. Sistem mencari payment sebelumnya berdasarkan `booking_id`.
3. `payment_type` ditentukan sebagai `dp`, `pelunasan`, atau `full_payment`.
4. Nominal divalidasi.
5. Row payment dibuat.
6. Booking dipindah ke `waiting_confirmation`.
7. Untuk group booking, sibling booking dapat ikut dibuatkan payment.
8. Notifikasi, sync BizPortal, dan audit log dipanggil.

#### Kontrol yang sudah ada

- ownership check tersedia bila request membawa bearer token;
- status booking dibatasi;
- payment type DP/pelunasan dideteksi;
- nominal tidak boleh nol dan tidak boleh melebihi batas tertentu;
- duplicate pending diperiksa untuk tipe yang sama.

#### Temuan

**P1 / HIGH — duplicate payment race**

Pengecekan duplicate pending dan insert payment terpisah. Dua request bersamaan dapat sama-sama melihat tidak ada pending payment, lalu sama-sama melakukan insert.

Risiko:

- dua DP atau dua pelunasan;
- dua notifikasi;
- dua history;
- dua event accounting;
- total payment melewati tagihan.

Kontrol wajib:

- transaksi database;
- lock booking `SELECT ... FOR UPDATE`;
- unique partial index atau tabel payment-intent yang mengunci intent aktif;
- validasi ulang remaining balance di dalam transaksi yang sama.

**P1 / HIGH — nominal confirmed belum menjamin settlement**

Validasi saat ini terutama membatasi nominal maksimum. Nominal `full_payment` atau pelunasan yang lebih kecil masih dapat dikonfirmasi dan booking langsung menjadi `confirmed`.

Kontrol wajib:

```text
confirmed_total + current_payment <= grand_total
```

Untuk full payment:

```text
current_payment == remaining_balance
```

Toleransi pembulatan harus eksplisit, terpusat, dan sama di payment, bank, invoice, serta accounting.

**P2 / MEDIUM — state transition non-confirmation terlalu longgar**

Konfirmasi sudah memakai conditional update dari `pending`, tetapi update `rejected`, notes, atau payment method tidak menerapkan matrix transisi yang sama secara konsisten.

Minimal matrix:

```text
pending            -> confirmed | rejected
confirmed          -> reversed  (bukan rejected)
rejected           -> pending   (hanya resubmission baru, bukan edit status langsung)
reversed           -> terminal
```

## 5. Jalur konfirmasi admin/web dan WhatsApp

### 5.1 Admin web

Lokasi: `artifacts/api-server/src/routes/payments.ts:453-735`.

Hal yang benar:

- konfirmasi memakai conditional update `WHERE id = ? AND status = 'pending'`;
- callback/request kedua terhadap payment confirmed menjadi no-op;
- hanya satu request yang dapat claim row pending pada level update.

Risiko yang masih tersisa:

- accounting dipanggil setelah perubahan status melalui fire-and-forget Promise;
- jika proses mati setelah commit payment tetapi sebelum accounting selesai, payment tetap confirmed tanpa jurnal;
- jika ada route lain yang membuat jurnal langsung, atomic claim payment tidak melindungi jurnal dari route tersebut;
- group booking mempunyai jalur accounting berbeda dari single booking.

### 5.2 WhatsApp

Lokasi utama: `artifacts/api-server/src/routes/whatsapp.ts:863-960`, `1213-1305`, `1809-1894`.

Terdapat beberapa jalur WhatsApp yang mengubah payment/booking menjadi confirmed dan memanggil `postConfirmedPaymentAccounting`.

Risiko:

- semakin banyak entry point, semakin besar kemungkinan satu payment dikonfirmasi dari dua kanal;
- seluruh kanal harus menggunakan command service yang sama, bukan mengulang logic update dan accounting;
- token action/review mengontrol akses, tetapi token belum menjadi idempotency key accounting;
- harus ada provider/channel event ID yang disimpan permanen.

Kontrol wajib:

- semua kanal memanggil satu `confirmPayment(paymentId, actor, eventId)` service;
- service melakukan state transition, balance check, outbox insert, dan audit dalam satu transaksi;
- endpoint hanya mengembalikan hasil event yang sama bila `eventId` dikirim ulang.

## 6. Jalur Paylabs

Lokasi: `artifacts/api-server/src/routes/paylabsPayment.ts`.

### 6.1 Hal yang sudah benar

- `merchant_trade_no` disimpan sebelum request ke Paylabs;
- finalize mencari transaksi berdasarkan exact `merchantTradeNo`;
- row transaksi dikunci dalam transaksi database;
- raw notification disimpan;
- status transaksi provider dipakai untuk menangani callback berulang.

### 6.2 Temuan kritis

**P1 / HIGH — create-payment tidak punya ownership/auth boundary yang cukup**

`POST /api/paylabs/create-payment` menerima `bookingId` dan membaca booking tanpa auth/ownership guard yang terlihat pada route tersebut.

Risiko:

- user dapat membuat transaksi gateway untuk booking milik user lain;
- provider transaction dapat dibuat berulang;
- project lain dapat memanggil endpoint dengan ID booking yang bukan miliknya.

Kontrol:

- customer token atau signed booking token;
- admin authorization;
- tenant/project check;
- rate limit;
- audit actor dan request ID.

**P1 / HIGH — refresh membuat transaksi Paylabs baru**

Trade number dibuat menggunakan timestamp dan tidak ada active intent lock. Refresh atau request bersamaan dapat membuat beberapa transaksi PENDING untuk booking yang sama.

Kontrol:

- `payment_intent_id` deterministik;
- satu active provider transaction per booking + payment type;
- unique partial index untuk status aktif;
- reuse transaction PENDING yang masih valid.

**P1 / HIGH — Paylabs selalu membentuk full_payment**

Finalize menggunakan jumlah transaksi provider dan memasukkan payment `full_payment`. Tidak terlihat validasi menyeluruh terhadap:

- payment type yang diminta;
- DP yang sudah dibayar;
- remaining balance;
- nominal callback/provider;
- transaksi provider lain yang sudah sukses.

Kontrol:

- payment intent menyimpan `payment_type`, expected amount, remaining balance, expiry;
- callback amount wajib sama dengan intent;
- status booking dan payment dihitung ulang dalam lock;
- pembayaran lebih dari remaining balance ditolak atau masuk manual review;
- Paylabs DP tidak boleh diteruskan sebagai full payment.

**P1 / HIGH — callback provider dapat menambah payment baru setelah kanal lain confirmed**

Jika transaksi Paylabs sendiri belum `SUCCESS`, callback berikutnya dapat insert payment baru walaupun booking telah confirmed dari web/admin/WhatsApp. Pemeriksaan `previousPaymentStatus` pada transaksi Paylabs tidak sama dengan pemeriksaan existing payment untuk booking.

Kontrol:

- unique provider transaction ID pada payments;
- sebelum insert, lock booking dan cari payment confirmed yang matching;
- callback yang sudah terwakili harus menjadi `already_processed`, bukan insert baru;
- provider order ID wajib disimpan sebagai immutable external key.

## 7. Accounting internal Sport Center

Lokasi: `artifacts/api-server/src/lib/accounting.ts:917-1076`.

Jurnal booking yang diharapkan:

```text
DEBIT  Bank/Kas                 = DPP + PPN
CREDIT Pendapatan Sport Center  = DPP
CREDIT PPN Keluaran             = PPN
```

`createJournalEntry()` memiliki idempotency check berdasarkan:

```text
payment_id + journal_type + is_reversal=false
```

Namun check ini hanya efektif bila `paymentId` diteruskan dan insert tidak terkena race. Belum terlihat unique constraint database yang memaksa kombinasi tersebut unik.

### Bukti kasus SC-0016

Database development menunjukkan:

```text
sport_payments:
  id=29, booking_id=82, amount=100000, payment_type=full_payment, status=confirmed

accounting_journals:
  id=13, payment_id=NULL, debit=100000, revenue=90090, ppn=9910
  id=14, payment_id=NULL, debit=109910, revenue=100000, ppn=9910
```

Jurnal 13 benar. Jurnal 14 adalah duplikat yang salah nominal.

Audit log juga menunjukkan dua `ACCOUNTING_ERROR` pada public accounting karena duplicate key di accounting entry. Ini menunjukkan lebih dari satu accounting path bekerja hampir bersamaan, sementara internal journal belum dilindungi constraint yang setara.

### Kontrol wajib

1. `payment_id` wajib `NOT NULL` untuk `journal_type='payment_confirmed'`.
2. Unique index:

```sql
CREATE UNIQUE INDEX ...
ON sport_center.accounting_journals(payment_id, journal_type)
WHERE payment_id IS NOT NULL
  AND is_reversal = false;
```

3. Semua sumber konfirmasi harus memanggil satu service.
4. Header dan lines dibuat dalam satu transaksi.
5. Validasi balance sebelum commit:

```text
sum(debit) = sum(credit)
debit = payment amount
credit revenue + credit tax = payment amount
```

6. Jurnal yang sudah posted tidak dihapus; koreksi dilakukan melalui reversal yang merujuk jurnal asli.
7. DP dan pelunasan harus punya payment ID dan event type berbeda, bukan hanya booking ID.

## 8. Public accounting, BizPortal, dan PPN

### 8.1 Public accounting

Lokasi: `artifacts/api-server/src/lib/accounting.ts:130-250` dan fungsi related.

Kekuatan:

- correlation ID sudah diarahkan ke `sc_payment_<paymentId>` bila payment ID tersedia;
- public entry memiliki GL lines;
- entry diposting setelah lines dibuat;
- PPN dicatat ke `tax_transactions` bila ada.

Risiko:

**P1 / HIGH — SELECT-then-INSERT tidak cukup untuk idempotensi**

Pengecekan correlation ID sebelum insert masih rentan race. Unique database constraint harus menjadi pengaman utama.

**P1 / HIGH — accounting dipanggil fire-and-forget**

Booking/payment dapat commit sementara public accounting gagal atau belum dibuat. Log error saja tidak menyediakan replay otomatis.

**P1 / HIGH — beberapa arti `source_id`**

`source` dan `source_id` digunakan untuk berbagai tipe transaksi. Convention ini tidak cukup sebagai kontrak lintas project bila project lain menggunakan ID yang sama atau makna berbeda.

Kontrak minimum:

```text
source_system
source_schema
source_table
source_id
source_event_id
event_type
correlation_id
provider
provider_transaction_id
amount
currency
dpp
tax_rate
tax_amount
environment
occurred_at
```

### 8.2 BizPortal mirror

Lokasi: `artifacts/api-server/src/lib/bizportalSync.ts:793-937`.

Payment mirror menggunakan:

```text
SCPAY-SC-{sport_center_payment_id}
```

Ini pola yang baik, tetapi tetap perlu constraint database dan source key formal. Sync saat ini dapat berjalan dari scheduler, event, atau manual resync. Tanpa outbox dan lease, proses-proses tersebut dapat overlap.

Kontrol:

- unique `(source_system, source_payment_id)`;
- mirror menyimpan source version/event ID;
- sync hanya satu arah dari source of truth;
- retry menggunakan status `unposted`/`failed`;
- status `posted` dengan entry ID yang valid tidak diposting ulang;
- manual resync aman bila dijalankan bersamaan dengan scheduler.

### 8.3 PPN

Formula yang harus dijaga:

```text
grand_total = DPP + PPN
```

Jika input harga sudah inclusive PPN, caller harus mengekstrak DPP lebih dulu. Jangan mengirim `totalPrice` inclusive sebagai DPP.

Kontrol:

- satu fungsi tax calculation sebagai source of truth;
- simpan snapshot `tax_rate`, `dpp`, `ppn_amount`, dan `grand_total` pada payment event;
- jangan menghitung ulang dari booking yang sudah berubah;
- setiap payment event yang memang mengakui pendapatan punya tax reference yang unik;
- reversal PPN harus merujuk tax transaction asli.

## 9. Bank mutation dan reconciliation

Lokasi: `artifacts/api-server/src/lib/bizportalSync.ts` dan `artifacts/api-server/src/routes/bankReconciliation.ts`.

### Risiko bentrok

1. Confirmed payment membuat synthetic bank mutation.
2. Import mutasi bank aktual dapat menemukan transaksi yang sama.
3. Jika tidak ada provider/import key yang sama, satu penerimaan dapat muncul dua kali.
4. Bank reconciliation kemudian dapat mem-post jurnal tambahan.

`accountingPosted=true` hanya menunjukkan flag pada mutation; audit harus memeriksa:

- mutation source dan provenance;
- linked journal entry;
- public accounting entry;
- GL lines;
- payment ID;
- PPN ledger;
- apakah entry yang linked berstatus posted.

Kontrol wajib:

```text
mutation_key harus immutable dan unique dalam source system
provider_name + provider_order_id harus unique bila tersedia
synthetic mutation harus diberi source='sport_center_payment'
bank import harus diberi source='bank_statement'
synthetic dan imported mutation tidak boleh otomatis dianggap dua cash receipt
```

Payment provider callback dan bank statement tidak boleh masing-masing membuat accounting entry independen. Keduanya harus mengacu pada satu payment event.

## 10. Daftar temuan prioritas

| ID | Severity | Temuan | Dampak |
|---|---|---|---|
| PAY-001 | P1 | Internal journal belum dipaksa unique per payment | Satu payment dapat menjadi dua jurnal |
| PAY-002 | P1 | `payment_id` dapat hilang/NULL pada posting | Idempotency berubah menjadi booking-level atau tidak bekerja |
| PAY-003 | P1 | Accounting fire-and-forget tanpa outbox | Payment confirmed tanpa jurnal |
| PAY-004 | P1 | Upload payment duplicate check non-atomic | Dua payment aktif untuk satu intent |
| PAY-005 | P1 | Paylabs create tidak cukup ownership protected | Booking orang lain / transaksi gateway liar |
| PAY-006 | P1 | Paylabs tidak mencegah multiple active transactions | Callback dan payment ganda |
| PAY-007 | P1 | Paylabs callback dapat insert setelah kanal lain confirmed | Payment/accounting overstatement |
| PAY-008 | P1 | Nominal confirmed tidak menjamin exact settlement | Booking confirmed dengan pembayaran kurang |
| PAY-009 | P1 | Public accounting correlation belum DB-enforced unique | Race pada public entry |
| PAY-010 | P1 | Synthetic bank mutation dapat bentrok dengan bank import | Cash receipt terhitung dua kali |
| PAY-011 | P2 | Banyak route mengulang logic confirmation | State/accounting drift antar kanal |
| PAY-012 | P2 | Source/ref hanya convention | Project lain dapat memakai ID/ref yang sama |
| PAY-013 | P2 | Mirror sync tidak durable/replayable | Gap antara operational DB dan BizPortal |
| PAY-014 | P2 | Reversal dan legacy rows perlu namespace formal | Repair salah sasaran atau audit trail rusak |

## 11. Kontrak integrasi wajib untuk project lain

### 11.1 Ownership

Project lain **tidak boleh**:

- insert langsung ke `sport_center.sport_payments`;
- update status booking Sport Center;
- membuat public accounting entry untuk event Sport Center;
- membuat bank mutation dari event yang sudah diposting;
- memakai order number Sport Center sebagai correlation key global;
- menafsirkan `source_id` tanpa `source_table` dan `source_system`.

Project lain harus menggunakan:

- API command resmi; atau
- event/outbox contract; atau
- central accounting posting service.

### 11.2 Identitas event

Setiap event finansial wajib memiliki:

```json
{
  "source_system": "sport_center",
  "source_environment": "development|production",
  "source_schema": "sport_center",
  "source_table": "sport_payments",
  "source_id": 29,
  "source_event_id": "payment-confirmed-29-v1",
  "event_type": "booking_payment_confirmed",
  "correlation_id": "sc_payment_29",
  "provider": "manual|paylabs|bank_statement",
  "provider_transaction_id": null,
  "amount": 100000,
  "currency": "IDR",
  "dpp": 90090,
  "tax_rate": 11,
  "tax_amount": 9910,
  "occurred_at": "2026-08-08T14:55:43.721Z"
}
```

`source_event_id` dan `correlation_id` tidak boleh dibuat ulang oleh consumer.

### 11.3 Idempotensi database

Minimum unique key:

```text
payments:
  (source_system, source_payment_id)

provider transaction:
  (provider, merchant_id, merchant_trade_no)

accounting event:
  (source_system, source_table, source_id, event_type)

public mirror:
  (source_system, source_payment_id)

bank mutation:
  (source_system, mutation_key)
```

Consumer harus aman bila event yang sama dikirim:

- dua kali;
- bersamaan;
- setelah timeout;
- setelah consumer sudah commit tetapi response hilang;
- setelah deployment/restart.

### 11.4 Outbox dan retry

Payment confirmation seharusnya melakukan satu transaksi:

```text
1. lock payment dan booking
2. validasi state + balance
3. ubah payment menjadi confirmed
4. buat audit history
5. insert accounting_outbox event
6. commit
```

Worker terpisah:

```text
outbox pending -> processing (lease) -> posted
                              -> failed/retry
                              -> dead_letter
```

Posting accounting tidak boleh menjadi side effect request HTTP yang hilang ketika proses mati.

## 12. Skenario uji wajib sebelum integrasi

| Skenario | Expected result |
|---|---|
| Dua upload bukti bersamaan | Satu payment intent aktif; request kedua no-op/409 |
| Dua admin confirm bersamaan | Satu state transition dan satu event |
| Callback Paylabs diulang 10 kali | Satu payment, satu journal, satu public entry |
| Paylabs callback setelah manual confirmation | Tidak membuat payment baru |
| Refresh create-payment 5 kali | Satu active provider transaction |
| DP lalu pelunasan | Dua payment dan dua event berbeda; total tidak melebihi grand total |
| Pelunasan kurang dari remaining balance | Ditolak atau tetap pending, bukan confirmed |
| Payment overpay | Ditolak/manual review |
| Server mati setelah payment commit | Outbox melanjutkan accounting |
| Public accounting timeout | Retry idempotent, tidak membuat entry kedua |
| Scheduler dan manual resync bersamaan | Tidak ada mirror/journal duplikat |
| Bank import dan synthetic mutation sama | Satu cash receipt dengan provenance jelas |
| Reversal/refund | Entry reversal mengacu entry asli; tidak menghapus history |
| Dua project memakai order number sama | Tidak bentrok karena namespace source system |
| Development callback masuk ke production | Ditolak oleh environment/provider credential boundary |

## 13. Query audit rekonsiliasi

Query berikut dapat dijadikan baseline audit setelah disesuaikan dengan koneksi/environment.

### 13.1 Satu payment lebih dari satu journal

```sql
SELECT payment_id, COUNT(*) AS journal_count,
       array_agg(id ORDER BY id) AS journal_ids
FROM sport_center.accounting_journals
WHERE payment_id IS NOT NULL
  AND is_reversal = false
GROUP BY payment_id
HAVING COUNT(*) > 1;
```

### 13.2 Booking dengan journal payment tanpa payment ID

```sql
SELECT id, booking_id, order_number, debit_amount, credit_revenue_amount,
       credit_ppn_amount, created_at
FROM sport_center.accounting_journals
WHERE journal_type = 'payment_confirmed'
  AND payment_id IS NULL
  AND is_reversal = false;
```

### 13.3 Payment confirmed tanpa journal internal

```sql
SELECT p.id AS payment_id, p.booking_id, b.order_number,
       p.amount, p.payment_type, p.confirmed_at
FROM sport_center.sport_payments p
JOIN sport_center.sport_bookings b ON b.id = p.booking_id
LEFT JOIN sport_center.accounting_journals j
  ON j.payment_id = p.id
 AND j.journal_type = 'payment_confirmed'
 AND j.is_reversal = false
WHERE p.status = 'confirmed'
  AND j.id IS NULL;
```

### 13.4 Booking total versus confirmed payment

```sql
SELECT b.id, b.order_number, b.grand_total,
       COALESCE(SUM(p.amount::numeric), 0) AS confirmed_total
FROM sport_center.sport_bookings b
LEFT JOIN sport_center.sport_payments p
  ON p.booking_id = b.id
 AND p.status = 'confirmed'
GROUP BY b.id, b.order_number, b.grand_total
HAVING COALESCE(SUM(p.amount::numeric), 0) <> b.grand_total::numeric;
```

### 13.5 Payment mirror tanpa public entry

```sql
SELECT sp.id, sp.payment_number, sp.amount, sp.posting_status, sp.entry_id
FROM public.sport_payments sp
WHERE sp.source = 'SPORT_CENTER_SUPABASE'
  AND (sp.entry_id IS NULL OR sp.posting_status <> 'posted');
```

### 13.6 Public entry tidak balance

```sql
SELECT entry_id,
       SUM(debit) AS total_debit,
       SUM(credit) AS total_credit
FROM public.accounting_entry_lines
GROUP BY entry_id
HAVING SUM(debit) <> SUM(credit);
```

## 14. Rencana remediasi yang disarankan

### P0 — sebelum project lain berbagi accounting

1. Freeze direct writes dari project lain ke tabel accounting/payment Sport Center.
2. Tambahkan unique constraint payment-to-journal.
3. Jadikan payment ID wajib untuk event payment accounting.
4. Satukan seluruh kanal konfirmasi ke satu command service.
5. Tambahkan outbox durable untuk accounting dan mirror.
6. Audit dan reverse jurnal duplikat yang sudah ada melalui prosedur resmi.

### P1 — sebelum production scale-up

1. Tambahkan provider transaction idempotency dan active intent lock.
2. Tambahkan ownership/tenant/environment guard pada Paylabs create-payment.
3. Enforce exact settlement dan cumulative payment balance.
4. Tambahkan unique correlation constraint pada public accounting.
5. Pisahkan synthetic bank mutation dari bank statement import dengan provenance.
6. Buat reconciliation job yang menghasilkan exception report, bukan blind insert.

### P2 — governance

1. Centralize COA/accounting ownership.
2. Dokumentasikan event schema dan versioning.
3. Tambahkan dead-letter queue dan replay approval.
4. Terapkan monthly closing/approval matrix pada reversal dan manual repair.
5. Simpan audit evidence untuk setiap correction.

## 15. Keputusan integrasi

Sampai kontrol P0 dan P1 diterapkan, project lain hanya boleh:

- membaca data melalui API/reporting view;
- menerima event dalam mode read-only;
- mengirim payment intent melalui endpoint resmi;
- meminta accounting posting melalui central service;
- melakukan reconciliation tanpa membuat jurnal baru sendiri.

Project lain **tidak boleh** menggabungkan tabel payment atau accounting secara langsung hanya karena berada pada database/schema yang sama.
