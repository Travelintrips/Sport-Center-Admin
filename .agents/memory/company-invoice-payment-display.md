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

Date corrections for a paid company invoice must update the invoice's canonical
`paid_at` and synchronize `sport_bookings.paid_at` for both direct and
item-only-linked bookings in the same transaction.

**Why:** The invoice is one settlement event shared by its bookings; changing
only one booking would make list views and reconciliation disagree.

**How to apply:** Treat a paid invoice as the synthetic payment source in the
booking date correction endpoint, preserve its method/status/financial values,
and never insert a booking-level payment row.

Synthetic company-invoice payment IDs are negative display-only identifiers; never send them to booking payment CRUD endpoints. Invoice-level settlement repair must resolve the invoice through the booking relation and update all linked bookings together.

**Why:** The admin booking drawer previously sent a synthetic negative ID to `/payments/:id`, producing a 404 for paid company bookings.

**How to apply:** Keep company-invoice actions on invoice/booking synchronization endpoints, hide payment rejection/proof deletion for the synthetic row, and preserve the invoice as the single settlement event.