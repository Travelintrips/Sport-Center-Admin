---
name: Incremental payment accounting
description: Idempotency rule for mirrored Sport Center payments
---

Accounting payment Sport Center harus di-idempotensikan berdasarkan payment mirror/nomor payment, bukan hanya booking, karena satu booking dapat memiliki DP dan pelunasan terpisah.

**Why:** Menggunakan booking sebagai kunci akan menggabungkan atau menggandakan posting ketika satu booking memiliki lebih dari satu pembayaran.

**How to apply:** Simpan `entry_id` pada row payment mirror, gunakan correlation ID per payment, dan retry hanya untuk status `unposted` atau `failed`; status `posted` harus mengembalikan entry yang sama. Untuk jurnal internal, payment ID juga menjadi unique key dan transisi konfirmasi diklaim atomik dari `pending` ke `confirmed`.