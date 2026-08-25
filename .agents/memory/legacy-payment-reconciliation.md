---
name: Legacy payment reconciliation
description: Safe handling of legacy public.accounting_payments rows that lack public.sport_payments mirrors.
---

Legacy Sport Center accounting rows can have a valid `entry_id` while lacking a corresponding `public.sport_payments` row. A matching `ref` alone is not sufficient because historical payment rows may reuse refs with different amounts.

**Why:** In the audited development data, ref-only matches included amount conflicts, while the legacy stream still represented posted accounting history. Deleting or recreating those rows would risk double counting and destroy auditability.

**How to apply:** Classify rows first. Only link a one-to-one `ref + amount` match when the candidate is unique and unlinked. Keep dry-run as the default and record an audit event for every apply. Never delete, truncate, void, reprice, or recreate the legacy payment or accounting entry as cleanup.

For a mirror whose `entry_id` points to a deleted entry, restore its link only inside one transaction and only when the replacement entry is uniquely matched, posted, debit/credit balanced at the payment amount, and its PPN evidence exactly matches both source and public tax records. The repair may restore the related entry/source/tax foreign keys, but never alters financial values or ledger lines.

**Why:** A missing entry pointer can block otherwise legitimate booking corrections. Reattaching it from a reference match alone could instead bind a payment to the wrong historical journal or tax period.

**How to apply:** Treat any missing, duplicated, reversed, unbalanced, or tax-mismatched evidence as a manual-review exception; it is not an auto-repair candidate. Re-run dry-run after application to prove the operation is idempotent.