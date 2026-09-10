---
name: Paylabs commit status contract
description: The source of truth for showing a successful Paylabs payment to customers.
---

The Paylabs provider can report success before the internal payment transaction and booking update commit. Customer-facing success must therefore require the local transaction to be `SUCCESS` or the backend reconciliation outcome to be `confirmed`/`already_confirmed`; provider status alone is only evidence that recovery should run.

**Why:** Treating a provider inquiry response as final made the booking page show “payment successful” while the admin booking remained `pending_payment` when internal finalization failed.

**How to apply:** Return the post-reconciliation local transaction state, expose reconciliation failures, and make the frontend trust only the committed local/reconciliation result. Never silently mark the booking successful from `paylabs.status` alone.