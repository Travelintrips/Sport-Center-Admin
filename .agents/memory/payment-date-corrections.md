---
name: Payment date corrections
description: Safe behavior for admin corrections to a booking's payment date.
---

Payment-date corrections are accounting-affecting changes. Send only the fields
the admin changed so a payment-only correction never triggers booking-slot
validation. During an explicitly approved historical correction window, the
admin date endpoint may enable the posted-payment correction gate locally for
its database transaction. The gate must automatically return to off afterward,
and the correction must not rewrite posted public accounting evidence, amounts,
tax, status, or journal lines.

**Why:** A combined request can be rejected for a booking-date conflict even
when the admin only changed the payment date. The owner explicitly approved
temporarily relaxing the source-payment conflict guard while historical
operational dates are corrected, without reopening financial journal fields.

**How to apply:** Keep booking-date conflict checks limited to an actual booking
date edit. Set the correction flag with transaction-local scope only inside the
admin correction transaction; never make it a session/global default. Remove
the temporary flag from the endpoint when the correction window is closed.