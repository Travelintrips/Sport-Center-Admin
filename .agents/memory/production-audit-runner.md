---
name: Production audit runner
description: Read-only production audits must isolate optional-query failures and fingerprint counts inside one rolled-back transaction.
---

Read-only audit queries should run behind savepoints so an unavailable optional column or table cannot abort the surrounding transaction; baseline and final fingerprints must be collected before the final rollback.

**Why:** PostgreSQL aborts the whole transaction after a query error, which can silently turn final counts into false unknowns even when the safety gate passed.

**How to apply:** Keep the dedicated auditor role and `transaction_read_only=on` gate, use savepoints around best-effort probes, and report skipped probes separately from data anomalies.