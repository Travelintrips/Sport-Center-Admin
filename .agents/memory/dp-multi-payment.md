---
name: DP multi-payment flow
description: How DP + pelunasan settlement works — multiple payments per booking, payment_type enum, status transitions.
---

## Schema
- `payments.payment_type` enum: `dp | pelunasan | full_payment` (NOT NULL DEFAULT 'full_payment')
- Unique constraint on `booking_id` **removed** — multiple payments per booking allowed
- Old payments (before this change) get `payment_type = 'full_payment'` by default

## Flow
1. Customer sets DP amount: `POST /bookings/:id/dp` → sets `isDpPaid=true`, `downPayment=X`, status stays `pending_payment`
2. Customer uploads DP proof: `POST /payments` → auto-detects `payment_type=dp`, creates new record, booking → `waiting_confirmation`
3. Admin confirms DP: `PATCH /payments/:id {status:"confirmed"}` → booking → `pending_payment` (NOT confirmed), audit: `DP_PAYMENT_APPROVED`
4. Customer uploads pelunasan: `POST /payments` → auto-detects `payment_type=pelunasan`, booking → `waiting_confirmation`
5. Admin confirms pelunasan: → booking → `confirmed`, journal entry, audit: `FINAL_PAYMENT_APPROVED`

## Auto-detection logic in POST /payments
- If `booking.isDpPaid=false`: `full_payment`
- If `booking.isDpPaid=true`:
  - No existing dp payment (or all rejected): `dp`
  - Has pending/confirmed dp payment: `pelunasan`

## Duplicate prevention
- 409 if pending dp payment already exists for same booking
- 409 if pending pelunasan payment already exists

## Status transitions on rejection
- Reject dp or pelunasan: booking → `pending_payment` (customer re-uploads)

## API response
- `GET /bookings` and `GET /bookings/:order`: return `payments` (array, all payments) + `payment` (primary for backward compat) + `remainingAmount` (computed)

**Why:** One payment record per booking was insufficient for DP split-payment; admins need to track each stage separately and confirm them independently.


## Group booking DP total
For bookings linked by `groupRef`, the DP ceiling, remaining balance, and payment-proof amount use the group's `totalPayment` across all sessions, not the individual session's `grandTotal`.

**Why:** A recurring/group booking is presented and paid as one combined invoice; validating against one session incorrectly rejects a valid group DP.

All payment-type expected-amount validation must use the same group total, including `full_payment`; applying the group total only to the later ceiling check still rejects a valid combined payment.

**Why:** The customer page shows the combined invoice, while each representative booking row may retain only one session's amount.

## Recurring booking groups
- Recurring sessions are stored as separate booking rows but share a `groupRef`; DP and remaining-balance validation must use `booking_groups.total_payment`, not an individual row's `total_price`.

**Why:** A multi-session booking can show a group total larger than the selected session row, so validating against the row incorrectly rejects valid DP amounts.

## DP configuration versus confirmation
- `downPayment > 0` means a DP amount has been configured and must drive the first proof upload as `payment_type = dp`.
- `isDpPaid = true` means an admin has confirmed a DP payment; it must not be set during booking creation.

**Why:** Treating a configured DP as already paid caused recurring bookings to upload or display the first Rp100.000 transfer as `full_payment`.

**How to apply:** Use group-level `downPayment` for recurring bookings, propagate it to all sessions, and set `isDpPaid` only in the admin confirmation transition.

## Group confirmation safety
- Confirming a DP in a group must not downgrade a sibling already in `confirmed` or `completed` to `pending_payment`.
- A WhatsApp approval path must apply the same DP transition as the admin payment endpoint; treating a DP as a final confirmation leaves `isDpPaid` and sibling booking states inconsistent.

**Why:** A group can contain a reactivated/expired session alongside a previously approved session. Blind status propagation makes the group internally inconsistent and can turn a valid DP confirmation into a server error.

**How to apply:** Treat terminal siblings as immutable, reconcile only eligible non-terminal siblings, and make the operation transactional with an explicit conflict response when group states cannot be reconciled.

