---
name: Paylabs callback invariant
description: Non-obvious ordering and identity rules for Paylabs payment callbacks.
---

The gateway transaction relation must exist before the create-payment request is sent. Webhook processing must resolve the exact `merchantTradeNo` to the stored transaction and then use its `booking_id`; never infer a booking by parsing the trade number.

**Why:** Paylabs can deliver a callback immediately after accepting an order. If persistence happens only after the create response, the callback has no reliable transaction-to-booking relation and payment confirmation can be lost.

**How to apply:** Keep callback URL construction canonical (base URL without a trailing `/api`), preserve the exact raw request bytes for signature verification, and map provider status aliases before finalizing the transaction and booking in one database transaction.