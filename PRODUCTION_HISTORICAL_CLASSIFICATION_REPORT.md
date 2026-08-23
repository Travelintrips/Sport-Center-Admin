# Sport Center — Production Historical Classification Report

## Executive Summary

**Production record-level access: PASS**
**Transaction read-only: on**
**Database mutation: NONE**
**Count fingerprint: PASS — NO COUNT CHANGES**

Audit ini berjalan pada dedicated PostgreSQL role `sport_center_production_auditor` dalam satu transaksi read-only. Semua query dibatasi SELECT/WITH, query yang gagal diisolasi dengan savepoint, dan transaksi diakhiri dengan `ROLLBACK`. Tidak ada repair, retry, approval, posting, migration, atau deployment.

## Gap Classification

| Area | Current State | Evidence | Gap / Limitation | Severity |
|---|---|---|---|---|
| Corporate booking | PARTIALLY IMPLEMENTED | sport_bookings has payer_type, company_customer_id, billing_status, and company_invoice_id; record-level corporate rows require business classification. | No automatic conclusion from field presence alone. | MEDIUM |
| Corporate subscription / recurring | UNKNOWN | No recurring master evidence was included in this transaction-integrity query. | Requires code/schema inventory and occurrence-level joins. | HIGH |
| Weekly schedule / stop subscription | UNKNOWN | No dedicated subscription evidence was included. | Cannot prove stop behavior from booking rows. | HIGH |
| Corporate billing | NO ANOMALY FOUND | Invoice duplicate groups=0, orphan items=0, total mismatches=0. | Invoice arithmetic/linkage requires review where rows are returned. | HIGH |
| Event schedule | PARTIALLY IMPLEMENTED | Booking model contains booking_type and event pricing fields. | Fixed-schedule behavior and event-specific workflow require code evidence. | MEDIUM |
| Event / corporate check-in | GAP / REVIEW | Completed without check-in rows=376. | Historical rows can predate current guards; do not backfill automatically. | HIGH |
| Photo proof | UNKNOWN | Not established by the transaction query. | Need storage/media/code inventory; absence here is not proof of absence. | MEDIUM |
| Corporate / event reschedule | UNKNOWN | No reschedule table query was part of this integrity runner. | Requires dedicated reschedule schema and history evidence. | HIGH |
| Conflict detection | UNKNOWN | Not inferable from historical transaction rows alone. | Requires code-path audit and targeted read-only schedule checks. | HIGH |
| Payment handling | NO ANOMALY FOUND | Duplicate booking/type=16, duplicate references=6, orphan=0, confirmed terminal=0. | Corporate invoice billing may legitimately have no direct sport payment. | HIGH |
| Accounting | NO ANOMALY FOUND | Unbalanced journals=0, orphan lines=0. | Validate payment-level linkage and tax ledgers before any repair. | CRITICAL |
| Central Finance | REVIEW | Read-only processing evidence was queried when the table was present. | No mutation or replay was attempted. | HIGH |

## Baseline dan Final Fingerprint

| Table | Baseline | Final | |
|---|---:|---:|---|
| sport_center.sport_bookings | 432 | 432 | unchanged |
| sport_center.sport_payments | 377 | 377 | unchanged |
| sport_center.booking_history | 1238 | 1238 | unchanged |
| sport_center.payment_accounting_outbox | 363 | 363 | unchanged |
| sport_center.company_invoices | 4 | 4 | unchanged |
| sport_center.company_invoice_items | 40 | 40 | unchanged |
| sport_center.accounting_journals | 381 | 381 | unchanged |
| sport_center.accounting_journal_lines | 211 | 211 | unchanged |
| sport_center.bank_mutations | 0 | 0 | unchanged |
| sport_center.bank_reconciliation_matches | 68 | 68 | unchanged |
| sport_center.tax_transactions | 1137 | 1137 | unchanged |

## Deterministic Record-Level Findings

- Completed tanpa check-in: **376**
- Completed tanpa completed_at: **8**
- Future completed: **2**
- Terminal history mismatch: **360**
- Duplicate booking/payment type: **16**
- Duplicate provider references: **6**
- Confirmed payment pada terminal booking: **0**
- Orphan payment: **0**
- Outbox processing/failed: **39**
- Tax configuration deviations: **0**
- Reconciliation orphan matches: **68**
- Accounting unbalanced journals: **0**
- Accounting orphan lines: **0**

## Schema Source of Truth

Canonical reconciliation table detected: `sport_center.bank_reconciliation_matches`.
Public accounting entries available: **no**; accounting evidence therefore uses the detected `sport_center` journal tables.

## Recommended Implementation Order

1. Review every returned lifecycle/payment/accounting/reconciliation record using immutable evidence and payment identity.
2. Complete code/schema inventory for recurring, subscription stop, event, photo proof, and reschedule behavior.
3. Resolve only individually proven anomalies with a separately approved, idempotent change plan.
4. Re-run the same read-only audit and compare fingerprints before and after any future approved change.

## Machine-Readable Evidence

The complete result is stored in `PRODUCTION_TRANSACTION_INTEGRITY_AUDIT_REPORT.md`.
