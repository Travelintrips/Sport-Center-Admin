---
name: Paylabs callback invariant
description: Non-obvious ordering and identity rules for Paylabs payment callbacks.
---

The gateway transaction relation must exist before the create-payment request is sent. Webhook processing must resolve the exact `merchantTradeNo` to the stored transaction and then use its `booking_id`; never infer a booking by parsing the trade number.

**Why:** Paylabs can deliver a callback immediately after accepting an order. If persistence happens only after the create response, the callback has no reliable transaction-to-booking relation and payment confirmation can be lost.

Paylabs signature canonicalization must recursively omit object properties whose value is `null` before JSON hashing; arrays retain null elements. The callback verifier should use the path component of the persisted `notify_url`, not a guessed full URL or a hard-coded alternate path.

**Why:** Paylabs v4.8.1 explicitly excludes null fields and signs the path portion of the notifyUrl. Including `null` or using a different endpoint produces `SIGNATURE_INVALID` even when the RSA key and timestamp are correct.

**How to apply:** Keep callback URL construction canonical (base URL without a trailing `/api`), preserve the exact raw request bytes, use the shared body canonicalizer for outbound requests and webhook verification, persist/read notifyUrl before verifying callbacks, and map provider status aliases before finalization.