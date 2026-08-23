---
name: Production auditor schema visibility
description: A production primary connection and the dedicated auditor connection may not observe the same schema state.
---

Do not downgrade the read-only auditor or treat primary-only visibility as a verified production migration. When the application production connection sees a newly migrated object but `sport_center_production_auditor` does not, compare database identity, endpoint, port, and replication/refresh state, then rerun the auditor check.

**Why:** A schema migration can succeed on the application primary while the auditor targets a lagging replica or a different scoped database; marking the gate PASS would hide an unsafe verification gap.

**How to apply:** Keep the closure status NOT FINALIZED until the dedicated auditor observes the required objects with `transaction_read_only=on` and the audit transaction ends in `ROLLBACK`.