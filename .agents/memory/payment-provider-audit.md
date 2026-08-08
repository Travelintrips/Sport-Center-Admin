---
name: Payment provider audit
description: Current payment-provider boundary for the Sport Center booking flow.
---

The active booking flow supports manual bank transfer and QRIS proof upload. Paylabs is not present in the current application source, API routes, database settings, environment configuration, or repository history reviewed on 2026-08-08.

**Why:** Showing a Paylabs option without a real create-payment endpoint, callback verification, and credentials would let customers start a payment that the admin flow cannot reconcile.

**How to apply:** Treat Paylabs as a separate integration restoration project. Before exposing it in the customer UI, obtain the official API contract and connect its credentials through the approved integration/secrets flow, then implement server-side status verification and webhook handling.