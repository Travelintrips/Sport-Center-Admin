# Sport Center — Corporate, Recurring, Event & Reschedule Audit

## Scope and safety

Audit database Production dilakukan read-only dengan dedicated auditor role. Tidak ada INSERT, UPDATE, DELETE, DDL, approval, retry, posting, migration, atau deployment.

## Current architecture evidence

- Corporate booking fields tersedia pada `sport_bookings`: payer type, company customer, billing status, invoice link, DP, PPN, dan group reference.
- Event dibedakan melalui `booking_type` dan memiliki field pricing event.
- Check-in disimpan pada booking (`checked_in_at`); audit record-level menemukan completion tanpa check-in sebagai evidence yang perlu direview, bukan alasan untuk auto-fix.
- Invoice memiliki item yang menghubungkan invoice ke booking; arithmetic dan orphan item diperiksa dalam integrity report.
- Payment, accounting journal/lines, tax, outbox, dan reconciliation diperiksa dengan payment-level identity.
- Recurring master, stop-subscription semantics, photo-proof mandatory rules, dan reschedule occurrence lineage memerlukan code/schema inventory lanjutan; tidak disimpulkan hanya dari tabel booking.

## Classification

| Area | Verdict | Evidence boundary |
|---|---|---|
| Corporate booking/billing | PARTIALLY IMPLEMENTED | Data model mendukung corporate billing; setiap row tetap perlu klasifikasi payer/company/invoice/payment.
| Corporate recurring/subscription | UNKNOWN | Tidak ada bukti master subscription pada query integrity ini.
| Weekly schedule / stop subscription | UNKNOWN | Behavior tidak dapat dibuktikan dari historical booking rows saja.
| Event fixed schedule | PARTIALLY IMPLEMENTED | Event booking/pricing fields tersedia; workflow penuh perlu code evidence.
| Mandatory check-in | GAP / REVIEW | Completion tanpa check-in ditemukan atau perlu diverifikasi dari result JSON; historical remediation dilarang.
| Photo proof | UNKNOWN | Storage/media/mandatory linkage belum dibuktikan oleh query ini.
| Corporate/event reschedule | UNKNOWN | Lineage original→replacement dan approval history perlu audit khusus.
| Invoice after reschedule | UNKNOWN | Harus diverifikasi dari invoice item dan canonical occurrence date.
| Conflict checking | UNKNOWN | Memerlukan audit code path dan schedule-level evidence.

## Final verdict

Sistem saat ini **PARTIALLY IMPLEMENTED** untuk corporate/event data modeling dan payment/accounting controls. Fitur recurring subscription, stop subscription, photo proof mandatory, dan reschedule occurrence tidak boleh disebut implemented hanya karena ada field atau route; statusnya tetap UNKNOWN sampai evidence code dan record-level tersedia.

Lihat `PRODUCTION_HISTORICAL_CLASSIFICATION_REPORT.md` untuk classification berbasis row dan `PRODUCTION_TRANSACTION_INTEGRITY_AUDIT_REPORT.md` untuk evidence JSON lengkap.
