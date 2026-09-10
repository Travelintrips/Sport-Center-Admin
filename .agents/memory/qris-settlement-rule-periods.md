---
name: QRIS settlement rule periods
description: Effective-date and audit rules for Mandiri Direct QRIS settlement configuration.
---

Mandiri Direct QRIS settlement configuration must have only one active rule for
each company/provider/effective date. A replacement must explicitly identify
every active period it overlaps; the prior rule ends on the day before the new
rule starts. The closure, new rule, and their audit evidence are one atomic
transaction.

**Why:** Multiple active rules make historical QRIS classification ambiguous.
Best-effort audit logging or a retrospective cut-off can also leave financial
configuration inconsistent with accounting and reconciliation history.

**How to apply:** Serialize rule writes per company/provider and reject any
overlap unless all conflicting prior rules are explicitly approved for closure.
Do not deactivate an effective rule or manually end it before today. When an
effective rule is replaced, schedule the new one from tomorrow so today's
settlement history remains stable.