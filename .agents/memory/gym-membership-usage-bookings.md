---
name: Gym membership usage bookings
description: The chosen relationship between monthly gym membership check-ins and the central booking list.
---

Gym member usage is represented in both the membership check-in history and the central sport booking list. The mirrored booking is confirmed, has a zero visit price, is marked as prepaid by the membership, and carries the membership identity.

**Why:** The operations team needs one booking list for facility usage without treating a member visit as a new payment obligation, while the membership screen still needs its own check-in history.

**How to apply:** When a member check-in is created, create its linked zero-value booking in the same transaction. When a check-in is undone, preserve the booking as cancelled for audit. WhatsApp daily usage should read member visits from check-ins and exclude mirrored membership bookings.