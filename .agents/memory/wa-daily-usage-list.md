---
name: WhatsApp Daily Usage List
description: Rules for the operational daily facility-usage message sent to admin WhatsApp destinations.
---

The admin daily usage list includes both `confirmed` and `completed` bookings for the current WIB date. It is grouped by facility and shows customer, time, booking type, people count when available, and check-in state.

**Why:** Completed bookings remain part of the day's operational usage record, and confirmed bookings can be added after the morning reminder window.

**How to apply:** Recompute the list whenever the scheduler runs, send only when its fingerprint changes, and persist that fingerprint so API restarts do not resend an unchanged list.

The canonical admin message is the `PEMAKAIAN SPORT CENTER` format from `rekapPemakaian`. Do not also run the legacy `DAFTAR PEMAKAIAN SPORT CENTER` scheduler sender, because both target the same admin WhatsApp destinations and create duplicate lists.

**Why:** The two senders use different deduplication mechanisms and can both send for the same booking date, producing two messages a few minutes apart.

**How to apply:** Keep event-triggered and scheduled sends routed through the canonical rekap sender; leave the legacy formatter unused unless it is explicitly reworked into that same pipeline.