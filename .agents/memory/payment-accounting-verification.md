---
name: Payment accounting verification
description: Verification rule for the Sport Center payment mirror and accounting implementation.
---

Acceptance untuk payment mirror tidak boleh dinilai dari keberadaan fungsi posting atau status `posted` saja; bukti wajib mencakup linkage payment→mirror→entry, GL balance, tax ledger, replay, dan failure recovery.

**Why:** Mock SQL integration tests dapat tertinggal dari invariant database yang baru ditambahkan, sementara workflow/typecheck dapat gagal karena dependency atau artefact build; keduanya bukan pengganti verifikasi database-backed.

**How to apply:** Pisahkan status implementasi kode, status migrasi/schema, dan status verifikasi runtime/test. Jangan menyatakan task selesai sebelum ketiganya memenuhi acceptance criteria.

Untuk recovery outbox, hanya event `posted` yang terbukti kehilangan journal internal boleh di-reset langsung; status `failed` harus mempertahankan backoff retry dan `processing` tidak boleh direbut oleh rekonsiliasi.

**Why:** Rekonsiliasi periodik yang mereset semua row tanpa journal dapat menghapus backoff error dan membuat worker melakukan retry agresif atau mengambil lock aktif.

**How to apply:** Rekonsiliasi payment confirmed harus idempoten, payment-level, dan memvalidasi journal internal sebelum menandai outbox selesai.

Sport Center menyimpan `bank_account_id` sebagai nomor rekening teks, sedangkan mirror `public.sport_payments.bank_account_id` milik BizPortal adalah foreign key integer. Jangan meneruskan nomor rekening mentah ke kolom mirror tersebut; simpan sebagai metadata teks pada jurnal atau gunakan pemetaan internal yang tervalidasi.

**Why:** Nomor rekening dapat melebihi batas integer dan tidak sama dengan ID baris rekening, sehingga konfirmasi pembayaran gagal dengan overflow atau foreign-key violation.

**How to apply:** Validasi boundary antara source Supabase, mirror publik, dan jurnal setiap kali alur konfirmasi atau replay accounting diubah.