---
name: Payment-accounting integration contract
description: Cross-project ownership and idempotency rules for Sport Center financial events.
---

Project lain tidak boleh menulis langsung ke payment, booking, bank mutation, atau accounting Sport Center. Semua event finansial harus memakai source system/table/id, immutable event ID, event type, correlation ID, provider transaction ID, amount, tax snapshot, environment, dan database-enforced uniqueness.

**Why:** Audit SC-0016 membuktikan satu payment dapat menjadi dua jurnal ketika payment_id hilang dan idempotensi hanya bergantung pada application checks atau in-memory state.

**How to apply:** Jadikan Sport Center sebagai source of truth operasional, gunakan satu confirmation service + durable outbox, dan audit payment→mirror→bank→journal→tax berdasarkan payment/event ID, bukan order number saja.