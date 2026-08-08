---
name: Legacy payment reconciliation
description: Safe handling of legacy public.accounting_payments rows that lack public.sport_payments mirrors.
---

Legacy Sport Center accounting rows can have a valid `entry_id` while lacking a corresponding `public.sport_payments` row. A matching `ref` alone is not sufficient because historical payment rows may reuse refs with different amounts.

**Why:** In the audited development data, ref-only matches included amount conflicts, while the legacy stream still represented posted accounting history. Deleting or recreating those rows would risk double counting and destroy auditability.

**How to apply:** Classify rows first. Only link a one-to-one `ref + amount` match when the candidate is unique and unlinked. Keep dry-run as the default; any apply operation may update only the nullable mirror-link field and must record an audit event. Never delete, truncate, or void the legacy payment or accounting entry as cleanup.