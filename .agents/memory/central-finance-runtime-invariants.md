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

Integration fixtures for central settlement must provide a non-null
`expected_settlement_date` matching the payment's effective date, plus mock the
canonical mutation and settlement-batch queries.

**Why:** Central settlement intentionally fails closed when settlement metadata
or canonical public evidence is missing; tests should model that production
contract rather than bypass it with null fixtures.

**How to apply:** When adding payment accounting cases, populate settlement
metadata in every source-payment mock and keep fake SQL responses aligned with
`centralSettlement.ts`.