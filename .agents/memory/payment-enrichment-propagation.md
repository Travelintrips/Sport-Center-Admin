---
name: Payment enrichment propagation
description: Runtime contract for canonical payment dimensions and historical classification
---

Every payment enrichment caller must pass the canonical provider and paid timestamp, plus the same effective-date context to company/account/expected-settlement resolution. Manual creation, admin confirmation, and Paylabs finalization are separate paths and must all preserve this contract.

**Why:** Settlement account and expected settlement date are effective-dated. Re-deriving context inconsistently can resolve different rules, while replaying a missing source must never erase an existing payment snapshot.

**How to apply:** Use explicit enrichment options for trusted company fallback and effective settlement configuration when available. Apply resolved fields with COALESCE semantics on confirmation/replay. Historical classification remains pure recommendation-only; ambiguity or missing evidence must not trigger mutation.