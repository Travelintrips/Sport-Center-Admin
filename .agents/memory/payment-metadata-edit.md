---
name: Payment metadata-only edits
description: Rules for editing payment method/provider without financial side effects
---

Metadata-only payment edits go through a dedicated endpoint (PATCH /payments/:id/metadata), never the broad payment update route — the broad route now rejects method/provider changes without a status change.

**Why:** The broad route mutates settlement dimensions, provider IDs, OCR data, and bank-mutation links; the task contract requires metadata edits with zero financial/settlement/journal side effects.

**How to apply:**
- Only paymentMethod/paymentProvider (+ derived providerName) may change; all other fields are rejected by explicit whitelist/deny lists.
- `sport_payments.payment_provider` is NOT NULL — non-QRIS methods use canonical `'unknown'`, never null.
- QRIS always forces provider `mandiri_direct` (Bank Mandiri CST settlement), even on legacy rows storing another provider.
- Confirmed payments re-enter the DB mirror/resolver (`resolve_and_persist_payment_metadata`); a method change with no owner-approved `payment_settlement_configs` rule raises `CANONICAL_PROVIDER_RULE_UNRESOLVED` — surface as a clear 409 (fail closed), don't treat as a bug.
- Journal metadata sync is handled by DB triggers `sync_payment_accounting_journal` (metadata-only) and `guard_posted_accounting_journal` (posted journals allow only payment_method/payment_provider changes).
