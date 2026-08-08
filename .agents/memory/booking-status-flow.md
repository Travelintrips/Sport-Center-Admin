---
name: Booking status flow
description: Complete booking lifecycle, INACTIVE_STATUSES, and what triggers each transition
---

## Status lifecycle
pending_payment → waiting_confirmation → confirmed → completed (auto by scheduler)
                                       ↘ pending_payment (on payment rejection)
pending_payment → expired (auto by scheduler after paymentDeadline)
any_active → cancelled (customer/admin request)
any_active → rejected (admin decision)

## INACTIVE_STATUSES
`["cancelled", "expired", "rejected", "refunded"]`
Conflict checks must exclude ALL of these (not just "cancelled").

## Payment flow
- Proof upload → booking status: `waiting_confirmation`, payment status: `pending`
- Admin confirms payment → booking status: `confirmed` (NOT "completed"), payment status: `confirmed`
- Admin rejects payment → booking status: `pending_payment`, payment status: `rejected`
- Auto-complete by scheduler: booking date + endTime passed + status is `confirmed` → `completed`

## Auto-expire
Scheduler runs every 5 min. Bookings with status `pending_payment` + `paymentDeadline < now()` → expired.
Payment deadline set on booking creation: `now() + 30 minutes`.

**Why:** "completed" should only mean the activity slot has passed, not just that payment was received.

## Expired booking reactivation
The customer-facing booking detail page allows an `expired` booking to reopen its payment instructions and upload a transfer proof. The existing payment submission then moves it to `waiting_confirmation` for admin verification.

**Why:** Customers may still complete a valid transfer after the original deadline; reactivation must preserve the booking/order history and require admin confirmation rather than silently confirming it.
