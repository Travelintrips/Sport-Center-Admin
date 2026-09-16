---
name: Company invoice payment display
description: How company invoice settlement details appear on linked bookings without duplicating accounting payments.
---

Company invoice settlement is one financial event at invoice level. Store its canonical method and paid date on the invoice, then expose a read-only synthetic payment representation on linked booking views for display and date columns.

**Why:** Creating one payment row per booking for a single company invoice would duplicate settlement evidence and can double-count accounting entries.

**How to apply:** Keep booking-level synthetic rows locked from payment-method edits, propagate the invoice paid timestamp to linked booking `paid_at` for existing date consumers, and use only the invoice payment for accounting/journal posting.

Legacy rows may not have `company_invoice_id` populated on the booking even when
`company_invoice_items.booking_id` links the booking to a paid invoice. Read both
relations when building admin booking payment metadata.

**Why:** Older invoice generation paths can preserve the item relation without
backfilling the booking foreign-key field, which otherwise leaves paid bookings
with blank payment method and date.

**How to apply:** Resolve direct booking invoice IDs first, then union them with
invoice IDs found through invoice items; keep the synthetic payment read-only and
use the item amount for the individual booking display.