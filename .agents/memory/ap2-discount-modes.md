---
name: AP2 discount modes
description: Business rule for percentage versus fixed nominal AP2 discounts.
---

AP2 discount settings support either a percentage or a fixed nominal amount. When a positive fixed amount is configured, it takes precedence over the percentage and is capped at the booking's base price. Clearing the fixed amount restores percentage-based behavior.

**Why:** Operations need to enter an agreed AP2 discount amount directly when the policy is not a fixed percentage.

**How to apply:** Keep the fixed amount interpreted per booking/session for recurring bookings. Preserve the separate AP Multiguna special hourly-price rule rather than applying the generic AP2 setting to that facility.