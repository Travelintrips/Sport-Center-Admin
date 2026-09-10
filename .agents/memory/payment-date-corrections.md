---
name: Payment date corrections
description: Safe behavior for admin corrections to a booking's payment date.
---

Payment-date corrections are accounting-affecting changes. Send only the fields
the admin changed so a payment-only correction never triggers booking-slot
validation. During an explicitly approved historical correction window, the
admin date endpoint may enable the posted-payment correction gate locally for
its database transaction. The gate must automatically return to off afterward,
and the canonical date must propagate to the linked public payment mirror.
Amounts, tax, status, accounting entry identity, and journal lines remain
unchanged.

**Why:** A combined request can be rejected for a booking-date conflict even
when the admin only changed the payment date. The owner explicitly approved
temporarily relaxing the source-payment conflict guard while historical
operational dates are corrected, without reopening financial journal fields.
The public payment mirror is part of the corrected payment metadata; leaving
its `paid_at` stale makes Supabase disagree with the admin UI.

**How to apply:** Keep booking-date conflict checks limited to an actual booking
date edit. Set the correction flag with transaction-local scope only inside the
admin correction transaction; never make it a session/global default. Remove
the temporary flag from the endpoint when the correction window is closed.
Under that flag, the mirror upsert may update only `paid_at` in addition to the
already-approved classification metadata; posted accounting entry and line
dates remain untouched.

PostgreSQL `UPDATE OF` triggers fire when a column appears in an upsert's `SET`
list even if its value is unchanged. Public classification synchronization must
return immediately when method/provider are unchanged, otherwise a paid-at-only
correction can be blocked by unrelated accounting-entry validation. The admin
date transaction must enable both the payment-metadata and accounting-metadata
transaction-local gates because settlement resolution can also repair stale
journal snapshots while processing the date correction.