---
name: Payment-level accounting references
description: Constraint needed when one booking has multiple confirmed payments.
---

For Sport Center payment postings, the public accounting reference must be payment-scoped. A booking/order reference is not unique when DP and pelunasan share one booking, and the shared public accounting uniqueness constraint rejects the second entry.

**Why:** The CF-SC-7D DEV rollback exposed a duplicate `(company_id, source, ref)` collision between DP and pelunasan.

**How to apply:** Keep the order number in the journal description, but use the payment number as `public.accounting_entries.ref`; retain `sc_payment_<id>` as the correlation and source identity.