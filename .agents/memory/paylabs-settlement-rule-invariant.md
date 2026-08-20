---
name: Paylabs settlement rule invariant
description: The canonical payment mirror fails closed unless a matching owner-approved settlement rule exists.
---

Confirmed Paylabs payments must have exactly one active `OWNER_APPROVED` settlement rule matching the resolved company, provider code, receiving bank account, effective date, and canonical rule version. If the provider-specific rule is absent, the canonical mirror raises `CANONICAL_PROVIDER_RULE_UNRESOLVED` with SQLSTATE `P0001`; do not bypass the trigger or weaken the constraint.

**Why:** Payment finalization can update the local booking and then fail at the canonical mirror trigger, leaving the provider transaction pending and the booking unpaid locally.

**How to apply:** Before retrying a genuine Paylabs recovery, inspect the effective settlement rules in the same environment. Add or correct only the missing owner-approved provider rule through the approved configuration path, then verify the recovery creates exactly one confirmed payment and expected settlement date.