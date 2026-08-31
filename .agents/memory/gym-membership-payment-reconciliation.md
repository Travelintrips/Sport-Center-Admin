---
name: Gym membership payment reconciliation
description: Standalone Gym membership fees are not yet represented as bank-recon payments.
---

Gym membership records sync to BizPortal as member/status data, but bank reconciliation currently matches only booking-backed payments. A membership fee without a booking cannot be auto-matched or approved safely.

**Why:** `sport_memberships` stores the membership and proof fields, while `sport_payments` requires a booking reference; treating a membership fee as a fake booking would corrupt booking and accounting history.

**How to apply:** Add a first-class membership payment identity and candidate type before enabling reconciliation; approval must activate/settle the membership and post one idempotent accounting event with the same provider metadata rules as booking payments.