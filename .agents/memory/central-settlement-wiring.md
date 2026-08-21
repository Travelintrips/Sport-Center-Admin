---
name: Central settlement wiring
description: Central Sport Center payments must invoke the existing settlement owner after canonical public mutation creation.
---

The central runtime uses the existing `sport_center.create_payment_settlement_batch` function rather than a second settlement engine. Its legacy-compatible implementation requires a posted payment-scoped `sport_center.accounting_journals` source row, while central ownership requires `canonical_bank_mutation_id` and no legacy mutation link.

**Why:** The settlement owner calculates MDR/net from active configuration and supplies the authoritative idempotency/concurrency behavior, but its historical active-group uniqueness conflicts with one batch per central payment.

**How to apply:** Central DEV wiring uses a payment-scoped settlement reference and excludes only that reference family from the legacy active-group unique index. Keep the change DEV-only until the payment matrix and production shadow plan are separately approved.