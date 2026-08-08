---
name: Bank reconciliation table naming
description: Non-obvious raw SQL and matching behavior for bank reconciliation.
---

Bank reconciliation matching does not filter candidates by payment method. It matches incoming mutations using amount, dates, booking status, description/name, order references, and OCR. Its raw SQL must use the actual `sport_center.sport_payments`, `sport_center.sport_bookings`, and `sport_center.sport_facilities` tables; legacy unprefixed names can make valid customer payments appear to have no candidates or break candidate details.

**Why:** The application schema uses sport-prefixed table names while several older raw SQL statements used legacy names, so a valid QRIS payment could exist in Supabase but never enter the matcher.

**How to apply:** When changing bank reconciliation queries, verify every raw `FROM`, `JOIN`, and `UPDATE` against `lib/db/src/schema`, and rerun AI Matching for existing bank mutations after the corrected build is published.