---
name: Company invoice payment display
description: How company invoice settlement details appear on linked bookings without duplicating accounting payments.
---

Company invoice settlement is one financial event at invoice level. Store its canonical method and paid date on the invoice, then expose a read-only synthetic payment representation on linked booking views for display and date columns.

**Why:** Creating one payment row per booking for a single company invoice would duplicate settlement evidence and can double-count accounting entries.

**How to apply:** Keep booking-level synthetic rows locked from payment-method edits, propagate the invoice paid timestamp to linked booking `paid_at` for existing date consumers, and use only the invoice payment for accounting/journal posting.