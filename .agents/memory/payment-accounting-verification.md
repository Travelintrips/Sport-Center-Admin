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