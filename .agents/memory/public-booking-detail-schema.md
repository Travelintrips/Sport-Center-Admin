---
name: Public booking detail schema
description: Group booking detail requires the payment allocation table in production.
---

The public booking detail endpoint reads payment allocations whenever a booking has a `group_ref`; production must provision `sport_payment_allocations` before serving grouped customer details.

**Why:** A missing allocation table turns a valid grouped booking detail request into HTTP 500, while the frontend's old fallback makes that look like “Booking Tidak Ditemukan” and hides payment upload.

**How to apply:** Include the idempotent allocation-table migration in production schema checks and keep customer detail errors distinct from a genuine 404.