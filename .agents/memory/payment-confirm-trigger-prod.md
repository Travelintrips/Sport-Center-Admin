---
name: Production payment-confirm trigger
description: Production Supabase may have the payment tables without the mirroring function or trigger.
---

For payment-confirmation incidents, verify both the function and the trigger on `sport_center.sport_payments`; production schema drift can leave either missing even when the tables exist.

**Why:** A production inspection found the expected tables but no mirroring function or trigger, so updating only a function would not restore the payment-confirmation path.

**How to apply:** Compare function markers and trigger definition in the target Supabase database, then apply the function and attach the trigger in one transaction; keep mirroring auto-bridge and non-fatal.