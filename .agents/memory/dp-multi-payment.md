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
