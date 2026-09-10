---
name: Posted journal metadata correction
description: Controlled handling for bulk corrections to posted Sport Center accounting journal metadata.
---

Bulk corrections to posted `sport_center` payment journals may change only payment classification metadata (`payment_provider`, `company_id`, and `bank_account_id`) when an explicit transaction-local correction gate is enabled. Never bypass the journal trigger; journal amounts, tax, COA, dates, status, reversal state, and lines remain immutable. Limit the scope to non-reversal `payment_confirmed` journals, verify before/after counts and balanced totals, and write an aggregate audit record in the same transaction.

**Why:** Posted journals are financial evidence. Direct trigger bypasses could silently change financial fields, while normal guards intentionally reject company and receiving-account corrections even when those fields are metadata.

**How to apply:** Use a guarded, idempotent Production script with explicit apply/confirmation flags and read-only post-commit verification. Do not infer provider identity for source payments or manual receipts merely because the journal target is a Mandiri settlement account.