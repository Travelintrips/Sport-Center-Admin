---
name: Payment date corrections
description: Safe behavior for admin corrections to a booking's payment date.
---

Payment-date corrections are accounting-affecting changes. Send only the fields
the admin changed so a payment-only correction never triggers booking-slot
validation. If the payment's linked public accounting evidence is missing,
reversed, or otherwise locked, fail with a controlled, actionable conflict;
never force the date update.

**Why:** A combined request can be rejected for a booking-date conflict even
when the admin only changed the payment date. A missing or locked accounting
entry means the payment's financial trail cannot be updated consistently, so a
silent source-only correction would create contradictory records.

**How to apply:** Keep booking-date conflict checks limited to an actual booking
date edit. For payment-date updates, surface the reconciliation prerequisite to
the admin and repair the historical mirror/journal linkage through the approved
reconciliation flow before retrying.