---
name: Central Finance runtime invariants
description: Non-obvious runtime requirements for central Sport Center accounting recovery and canonical mutation idempotency.
---

Adopting an already-posted Sport Center accounting entry must still ensure the
payment-scoped canonical public bank mutation before returning success.

**Why:** Returning early from an adoption path leaves accounting posted but
prevents settlement and reconciliation from finding canonical public evidence.

When `public.bank_mutations.canonical_key` is protected by a partial unique
index, an `ON CONFLICT` clause must include the matching `WHERE
canonical_key IS NOT NULL` predicate.

**Why:** PostgreSQL will reject an unconstrained `ON CONFLICT (canonical_key)`
when only a partial unique index exists, breaking all central retries before
the public mutation is created.

**How to apply:** Review both normal posting and already-posted/adoption paths,
and inspect the live index predicate before changing canonical mutation
upserts.