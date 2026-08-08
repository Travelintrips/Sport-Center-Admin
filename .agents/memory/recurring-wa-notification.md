---
name: Recurring booking WhatsApp notification
description: Notification behavior for web-created recurring/group bookings
---

Recurring/group bookings are created through a batch endpoint, so they must send one admin WhatsApp summary after every session is inserted and the group reference is assigned. The summary should include every order, schedule, session count, and combined total.

**Why:** Batch creation bypasses the single-booking notification hook. Without an explicit group notification, the bookings appear in the admin web list but are absent from the admin WhatsApp group.

**How to apply:** Keep the notification non-blocking and send it once per group, not once per session. Existing bookings are not resent automatically; use an explicit resend action if historical replay is ever needed.