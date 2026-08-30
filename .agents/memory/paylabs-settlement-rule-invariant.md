---
name: Paylabs settlement rule invariant
description: The canonical payment mirror fails closed unless a matching owner-approved settlement rule exists.
---

Confirmed QRIS/Paylabs payments must have exactly one active `OWNER_APPROVED` settlement rule matching the resolved company, provider code, receiving bank account, effective date, and canonical rule version. A rule can look valid in the admin UI yet still fail if its `rule_version` remains legacy; inspect that field explicitly. If the provider-specific rule is absent or version-mismatched, the canonical mirror raises `CANONICAL_PROVIDER_RULE_UNRESOLVED` with SQLSTATE `P0001`; do not bypass the trigger or weaken the constraint.

**Why:** Payment finalization or a historical date correction can reach the canonical mirror trigger and fail even when company, provider, account, and date appear correct, because the trigger also enforces the canonical rule version.

**How to apply:** Before retrying recovery or date correction, inspect every matching field in the same environment, including `rule_version`. Correct the existing rule rather than creating an overlapping duplicate, retain audit evidence, then verify the trigger predicate resolves exactly one rule.