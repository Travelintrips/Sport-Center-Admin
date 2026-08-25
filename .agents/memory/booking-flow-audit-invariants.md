---
name: Booking flow audit invariants
description: Cross-path rules that must stay consistent across single, recurring, group, event, and corporate bookings
---

All booking creation paths must enforce the same time-window, operating-hours, conflict, payment, approval, and lifecycle rules; specialized paths may add behavior but must not silently bypass the single-booking contract.

**Why:** Recurring and corporate flows can otherwise create records with different eligibility or status semantics, causing invalid reservations and premature completion.

**How to apply:** When adding or auditing a booking endpoint, compare it against the canonical single-booking flow and verify downstream invoice, scheduler, notification, and reporting behavior.

Completion is a session-lifecycle transition: it requires a recorded check-in and an elapsed booking end time. Payment, invoice settlement, or billing status must never complete a future session.

**Why:** Financial settlement and physical facility usage happen at different times, especially for corporate, group, DP, and recurring bookings.

**How to apply:** Enforce the invariant in every completion writer, including admin actions, WhatsApp actions, schedulers, webhooks, and reconciliation workers.