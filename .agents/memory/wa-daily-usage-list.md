---
name: WhatsApp Daily Usage List
description: Rules for the operational daily facility-usage message sent to admin WhatsApp destinations.
---

The admin daily usage list includes both `confirmed` and `completed` bookings for the current WIB date. It is grouped by facility and shows customer, time, booking type, people count when available, and check-in state.

**Why:** Completed bookings remain part of the day's operational usage record, and confirmed bookings can be added after the morning reminder window.

**How to apply:** Recompute the list whenever the scheduler runs, send only when its fingerprint changes, and persist that fingerprint so API restarts do not resend an unchanged list.