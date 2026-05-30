---
name: Booking PII & access control
description: Which booking endpoints are public vs admin, and what PII must be redacted from public responses.
---

# Booking endpoint access & PII redaction

`GET /bookings` (list) is **admin-only** (`adminMiddleware`) — it returns every customer's PII (name, email, phone, idCardNumber). All frontend callers are admin pages (`useListBookings` in admin Bookings/Schedule/Dashboard/Customers).

Public booking reads are `GET /bookings/order/:orderNumber` and `GET /bookings/:id` (customer invoice page via `useGetBookingByOrder`). These go through the `getBookingWithPayment` helper, which **redacts `idCardNumber` to null** — Angkasa Pura ID-card numbers are PII and order numbers are sequential/guessable, so never expose them on unauthenticated reads.

**Why:** a code review caught idCardNumber leaking through the public invoice endpoint.

**How to apply:** any new public booking-read path must reuse `getBookingWithPayment` (or otherwise strip idCardNumber). Only admin-scoped responses (list, verify) may include it. Normalize idCardNumber to `.trim().toUpperCase()` on booking create, AP-member create/update, and verify so scanned QR values match stored values.
