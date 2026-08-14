---
name: Confirmed payment reconciliation
description: Handling payment rows that are confirmed while their booking status remains pending.
---

When a payment is already confirmed but its booking remains in a pre-confirmation status, an admin retry should reconcile the booking and history without creating another payment, notification, or accounting entry.

**Why:** WhatsApp/provider confirmation paths perform related updates separately, so a process failure between them can leave a valid payment with a stale booking status.

**How to apply:** Limit repair to pending-payment states, keep the payment operation idempotent, record the status transition in booking history/audit, and expose a clearly labeled admin repair action.