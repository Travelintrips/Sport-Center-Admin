---
name: QRIS settlement account
description: Accounting mapping for Sport Center QRIS payments
---

QRIS Sport Center diselesaikan ke Bank Mandiri CST, sehingga jurnal internal dan public accounting harus memakai akun Bank Mandiri CST, bukan akun kas atau COA QRIS terpisah.

**Why:** Dana QRIS masuk ke rekening Bank Mandiri CST; akun kas akan membuat saldo bank dan rekonsiliasi salah.

**How to apply:** Gunakan label/kode internal Bank Mandiri dan COA public `1-1020-CST` untuk QRIS maupun Transfer Bank. Jangan mengoreksi jurnal lama secara massal tanpa daftar entry target dan verifikasi production.