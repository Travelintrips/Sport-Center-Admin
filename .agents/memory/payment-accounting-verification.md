---
name: Payment accounting verification
description: Verification rule for the Sport Center payment mirror and accounting implementation.
---

Acceptance untuk payment mirror tidak boleh dinilai dari keberadaan fungsi posting atau status `posted` saja; bukti wajib mencakup linkage payment→mirror→entry, GL balance, tax ledger, replay, dan failure recovery.

**Why:** Mock SQL integration tests dapat tertinggal dari invariant database yang baru ditambahkan, sementara workflow/typecheck dapat gagal karena dependency atau artefact build; keduanya bukan pengganti verifikasi database-backed.

**How to apply:** Pisahkan status implementasi kode, status migrasi/schema, dan status verifikasi runtime/test. Jangan menyatakan task selesai sebelum ketiganya memenuhi acceptance criteria.