---
name: Required payment provider metadata
description: Canonical metadata required for Sport Center booking payment records and mirrors.
---

Setiap row `sport_payments` wajib memiliki `bank_account_id`, `provider_name`, `provider_id`, dan `provider_order_id`. Untuk payment manual tanpa gateway, gunakan identifier internal yang dapat ditelusuri; untuk Paylabs, pertahankan order/merchant trade number provider.

**Why:** Rekonsiliasi bank dan accounting membutuhkan dimensi rekening penerima serta identitas provider/order yang tidak ambigu, termasuk untuk DP, pelunasan, retry, dan payment manual.

**How to apply:** Terapkan constraint database dan backfill saat migrasi, isi metadata di semua jalur insert, dan teruskan field tersebut ke API client serta mirror BizPortal.