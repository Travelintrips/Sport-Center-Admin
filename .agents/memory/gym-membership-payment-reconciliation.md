---
name: Gym membership payment history and reconciliation
description: Monthly Gym membership renewals must retain distinct payment identities and periods.
---

Every Gym registration or renewal is a separate financial event even though the member master is reused. Payment proof, period, amount, confirmation, bank mutation, and accounting references must follow the payment identity rather than being overwritten on the member.

**Why:** A membership ID survives across many monthly renewals. Using it as the sole mutation or journal key suppresses later payments and loses historical proof and period data.

**How to apply:** Create one immutable payment event per registration/renewal. Pending period edits may update that event, but confirmed history stays unchanged. Reconciliation and accounting references must include the payment ID.