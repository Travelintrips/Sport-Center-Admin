---
name: Payment provider audit
description: Current payment-provider boundary for the Sport Center booking flow.
---

The current source has two QRIS paths: manual QRIS proof upload and a Paylabs create-payment/webhook flow backed by `paylabs_transactions`. However, `sport_payments` stores only a broad payment method (for example QRIS), and bank reconciliation does not use Paylabs transaction identity or provider-specific candidate filtering.

**Why:** The earlier audit conclusion became stale after the Paylabs route, settings, and transaction table were added; the remaining risk is now provider attribution and reconciliation separation, not absence of a Paylabs flow.

**How to apply:** Treat `payment_provider` as a required canonical dimension for new QRIS payments and bank-reconciliation candidates. Preserve Paylabs merchant/platform references, classify manual QRIS explicitly, and keep provider, merchant/account, expected settlement date, and candidate transactions in separate reconciliation batches.
Sport Center now exposes canonical payment metadata on `sport_payments`: QRIS/manual flows must carry an explicit provider (`mandiri_direct` or `unknown`), while successful Paylabs flows carry `paylabs`, provider references, merchant/provider trade numbers, and a canonical `paid_at`.

**Why:** CST reconciliation needs provider-aware gross payment events, while Sport Center must not infer manual QRIS provider or calculate MDR.

**How to apply:** Keep Paylabs transaction relation persistence before provider calls, verify raw callback signatures, key replay idempotency by merchant trade number/payment mirror, and leave successful callbacks for terminal bookings in manual review rather than silently confirming them.
