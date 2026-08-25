---
name: PostgreSQL concurrency harnesses
description: Constraints for safe two-client PostgreSQL race proofs in DEV harnesses.
---

A PostgreSQL client must never receive overlapping queries. A true race is created
by issuing sequential statements on each of at least two independent clients,
then racing those client flows against each other. The pool must also have one
slot per retained connection plus the clients used by the race.

**Why:** `pg` warns or hangs when a single client is used concurrently; a harness
can appear to test cross-client behavior while actually serializing or deadlocking
inside its own pool.

**How to apply:** Keep per-client operations sequential, use `Promise.all` only
around independent clients, and account for audit/setup clients when choosing
`pool.max`.