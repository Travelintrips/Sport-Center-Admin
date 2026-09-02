---
name: Gym membership payment history and reconciliation
description: Monthly Gym membership renewals must retain distinct payment identities and periods.
---

Every Gym registration or renewal is a separate financial event even though the member master is reused. Payment proof, period, amount, confirmation, bank mutation, and accounting references must follow the payment identity rather than being overwritten on the member.

**Why:** A membership ID survives across many monthly renewals. Using it as the sole mutation or journal key suppresses later payments and loses historical proof and period data.

**How to apply:** Create one immutable payment event per registration/renewal. Pending period edits may update that event, but confirmed history stays unchanged. Reconciliation and accounting references must include the payment ID.

Each membership payment event also has one paired booking-order record marked as a membership payment, while daily member usage remains a separate zero-value booking. The payment order is the Bizportal reconciliation candidate; usage orders must not create new revenue.

**Why:** Bizportal's order matcher reads `sport_bookings`, while the membership ledger is intentionally separate. A single payment-linked order makes the event visible without turning check-ins into duplicate income.

**How to apply:** Key the payment order by the membership payment identity, sync it with the booking mirror, and keep check-in mirrors clearly marked as usage-only.