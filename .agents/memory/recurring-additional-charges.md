---
name: Recurring additional charges
description: Invariant for recurring and grouped booking additional-charge storage and totals
---

Additional charges are group-level for recurring bookings: the total is added once, stored on one successfully created session, and exposed through groupInfo so any session can show the detail. Admin edits must preserve one charge list by clearing sibling rows and recalculating the group total.

**Why:** Applying the same JSON charge list to every recurring session inflated invoices and made details disappear when customers opened a different session.

**How to apply:** Keep per-session facility pricing separate from the one-time charge in recurring previews, checkout totals, tax calculations, and admin/customer detail views.