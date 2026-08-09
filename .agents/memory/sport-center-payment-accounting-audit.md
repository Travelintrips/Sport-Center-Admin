---
name: Sport Center payment accounting audit
description: Audit rule for verifying automatic Sport Center payment posting into public accounting and tax ledgers.
---

Jangan menganggap `public.sport_payments.posting_status='posted'` sebagai bukti jurnal sudah masuk ke public accounting. Validasi wajib mencocokkan `entry_id` ke `public.accounting_entries.status='posted'`, memastikan GL lines, dan bila ada PPN memastikan pasangan `sport_center.tax_transactions` serta `public.gl_tax_lines`.

**Why:** Proyek memiliki jalur legacy booking posting dan jalur mirror payment BizPortal. Data bisa berstatus posted tanpa `entry_id`, dan sinkronisasi otomatis berjalan berkala, bukan pada setiap konfirmasi payment.

**How to apply:** Audit payment berdasarkan payment ID/payment number, bukan booking saja. Bedakan `SCPAY-{id}` legacy dari `SCPAY-SC-{id}` mirror. Periksa pula duplikasi `accounting_payments` sebelum melakukan repair atau reversal.

Pada 2026-08-09 ditemukan bahwa konfirmasi langsung dapat membuat `public.accounting_entries` dengan correlation `sc_payment_<id>` sementara row `public.sport_payments` mirror lama tetap `failed`, tanpa `source_payment_id`/`entry_id`; endpoint pending yang hanya menghitung row mirror yang hilang dapat melewatkan kasus ini.

**Why:** Dua pipeline tersebut tidak atomik dan mirror dijalankan berkala. UI dapat menampilkan payment seolah belum dijurnal walaupun entry public sudah posted, atau sebaliknya menampilkan pending=0 karena row failed sudah ada.

**How to apply:** Saat audit dan repair, cari payment confirmed yang mirror-nya ada tetapi `posting_status <> 'posted'` atau `entry_id` kosong, bukan hanya mirror yang belum ada. Jalankan repair berdasarkan `payment_number = SCPAY-SC-<source_payment_id>` dan validasi entry, GL lines, serta tax ledger sesudahnya.

Posting public payment harus memakai correlation canonical `sc_payment_<source_payment_id>`, meskipun mirror memakai nomor `SCPAY-SC-<id>`.

**Why:** Retry dari mirror lama harus dapat menemukan entry yang sudah dibuat oleh konfirmasi langsung dan mengisi linkage tanpa menduplikasi jurnal.

**How to apply:** Selalu teruskan source payment ID ke `postSportCenterBookingPayment`; gunakan indikator pending untuk mendeteksi mirror hilang, failed/unposted, atau entry yang tidak posted.