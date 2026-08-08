---
name: Payment provider audit
description: Current payment-provider boundary for the Sport Center booking flow.
---

Sport Center now exposes canonical payment metadata on `sport_payments`: QRIS/manual flows must carry an explicit provider (`mandiri_direct` or `unknown`), while successful Paylabs flows carry `paylabs`, provider references, merchant/provider trade numbers, and a canonical `paid_at`.

**Why:** CST reconciliation needs provider-aware gross payment events, while Sport Center must not infer manual QRIS provider or calculate MDR.

**How to apply:** Keep Paylabs transaction relation persistence before provider calls, verify raw callback signatures, key replay idempotency by merchant trade number/payment mirror, and leave successful callbacks for terminal bookings in manual review rather than silently confirming them.