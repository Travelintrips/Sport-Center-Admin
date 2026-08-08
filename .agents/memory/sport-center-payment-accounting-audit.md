---
name: Sport Center payment accounting audit
description: Audit rule for verifying automatic Sport Center payment posting into public accounting and tax ledgers.
---

Jangan menganggap `public.sport_payments.posting_status='posted'` sebagai bukti jurnal sudah masuk ke public accounting. Validasi wajib mencocokkan `entry_id` ke `public.accounting_entries.status='posted'`, memastikan GL lines, dan bila ada PPN memastikan pasangan `sport_center.tax_transactions` serta `public.gl_tax_lines`.

**Why:** Proyek memiliki jalur legacy booking posting dan jalur mirror payment BizPortal. Data bisa berstatus posted tanpa `entry_id`, dan sinkronisasi otomatis berjalan berkala, bukan pada setiap konfirmasi payment.

**How to apply:** Audit payment berdasarkan payment ID/payment number, bukan booking saja. Bedakan `SCPAY-{id}` legacy dari `SCPAY-SC-{id}` mirror. Periksa pula duplikasi `accounting_payments` sebelum melakukan repair atau reversal.