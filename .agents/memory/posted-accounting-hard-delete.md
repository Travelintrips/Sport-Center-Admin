---
name: Posted accounting hard delete
description: Confirmed bookings with posted journals cannot be hard-deleted safely.
---

Bookings linked to posted or reversed accounting journals must not be hard-deleted; use a cancellation/refund workflow with reversal entries and retain the audit trail.

**Why:** Production database triggers reject deletion of posted journals, and booking deletion cascades into those journals.

**How to apply:** If an operator requests deletion of a paid or confirmed booking, report the protected state and offer cancellation/void with accounting reversal instead of bypassing triggers.