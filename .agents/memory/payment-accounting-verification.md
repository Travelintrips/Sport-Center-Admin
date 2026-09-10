---
name: Payment accounting verification
description: Verification rule for the Sport Center payment mirror and accounting implementation.
---

Acceptance untuk payment mirror tidak boleh dinilai dari keberadaan fungsi posting atau status `posted` saja; bukti wajib mencakup linkage payment→mirror→entry, GL balance, tax ledger, replay, dan failure recovery.

**Why:** Mock SQL integration tests dapat tertinggal dari invariant database yang baru ditambahkan, sementara workflow/typecheck dapat gagal karena dependency atau artefact build; keduanya bukan pengganti verifikasi database-backed.

**How to apply:** Pisahkan status implementasi kode, status migrasi/schema, dan status verifikasi runtime/test. Jangan menyatakan task selesai sebelum ketiganya memenuhi acceptance criteria.

Untuk recovery payment accounting, audit harus mencari dua gap: header journal yang hilang dan header yang ada tetapi tanpa journal lines. Outbox `failed`/`processing` hanya boleh di-reset secara scoped untuk kandidat yang lock-nya stale.

**Why:** Header posted tanpa lines membuat status `posted` menyesatkan; reset global dapat menghapus backoff error atau mengambil lock aktif.

**How to apply:** Backfill lines memakai gate transaction-local yang hanya mengizinkan INSERT, lalu validasi debit/kredit balance sebelum outbox ditandai posted.

Sport Center menyimpan `bank_account_id` sebagai nomor rekening teks, sedangkan mirror `public.sport_payments.bank_account_id` milik BizPortal adalah foreign key integer. Jangan meneruskan nomor rekening mentah ke kolom mirror tersebut; simpan sebagai metadata teks pada jurnal atau gunakan pemetaan internal yang tervalidasi.

**Why:** Nomor rekening dapat melebihi batas integer dan tidak sama dengan ID baris rekening, sehingga konfirmasi pembayaran gagal dengan overflow atau foreign-key violation.

**How to apply:** Validasi boundary antara source Supabase, mirror publik, dan jurnal setiap kali alur konfirmasi atau replay accounting diubah.