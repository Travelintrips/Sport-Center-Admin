---
name: Booking flow audit invariants
description: Cross-path rules that must stay consistent across single, recurring, group, event, and corporate bookings
---

All booking creation paths must enforce the same time-window, operating-hours, conflict, payment, approval, and lifecycle rules; specialized paths may add behavior but must not silently bypass the single-booking contract.

**Why:** Recurring and corporate flows can otherwise create records with different eligibility or status semantics, causing invalid reservations and premature completion.

**How to apply:** When adding or auditing a booking endpoint, compare it against the canonical single-booking flow and verify downstream invoice, scheduler, notification, and reporting behavior.