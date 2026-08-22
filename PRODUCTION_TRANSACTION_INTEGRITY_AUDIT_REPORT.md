# Production Transaction Integrity Audit

**Run date:** 2026-08-23  
**Mode:** read-only production audit  
**Final verdict:** `PRODUCTION DATABASE = PASS` · `READ-ONLY = PASS` · `PRODUCTION DATA MUTATION = NONE`

## 1. Safety gate and fingerprint

| Check | Result |
|---|---|
| Database | `postgres` |
| Database role | `sport_center_production_auditor` |
| Server port | `5432` |
| `transaction_read_only` | `on` |
| Mutation queries | `0` |
| Query failures skipped | `0` |
| Final transaction | `ROLLBACK` |
| Baseline/final row-count fingerprint | `PASS — NO COUNT CHANGES` |

## 2. Baseline and final counts

| Table | Baseline | Final |
|---|---:|---:|
| `sport_center.sport_bookings` | 429 | 429 |
| `sport_center.sport_payments` | 374 | 374 |
| `sport_center.booking_history` | 1,231 | 1,231 |
| `sport_center.payment_accounting_outbox` | 363 | 363 |
| `sport_center.company_invoices` | 4 | 4 |
| `sport_center.company_invoice_items` | 40 | 40 |
| `sport_center.accounting_journals` | 381 | 381 |
| `sport_center.accounting_journal_lines` | 211 | 211 |
| `sport_center.bank_mutations` | 0 | 0 |
| `sport_center.bank_reconciliation_matches` | 68 | 68 |
| `sport_center.tax_transactions` | 1,134 | 1,134 |

## 3. Findings

| Area | Result | Classification |
|---|---:|---|
| Completed without check-in | 376 | `REVIEW` |
| Completed without `completed_at` | 8 | `REVIEW` |
| Completed sessions in the future | 2 (`380`, `511`) | `REVIEW` |
| Terminal bookings with zero or multiple terminal history events | 360 | `REVIEW` |
| Duplicate booking/payment-type groups | 16 | `REVIEW` / distinguish DP vs final vs retry |
| Duplicate provider/reference groups | 6 | `REVIEW` |
| Confirmed payment on terminal booking | 0 | `PASS` |
| Orphan payments | 0 | `PASS` |
| Duplicate invoice numbers | 0 | `PASS` |
| Orphan invoice items / missing booking IDs | 0 | `PASS` |
| Invoice total vs item-total mismatches | 0 | `PASS` |
| Outbox processing rows | 27 | `REVIEW` |
| Outbox failed rows | 12 | `REVIEW` |
| Duplicate outbox payment identities | 0 | `PASS` |
| Tax rows deviating from `PPN_OUT_11` at 11% | 0 | `PASS` |
| Duplicate tax reference groups | 3 | `REVIEW` |
| Orphan reconciliation matches | 68 | `REVIEW` |
| Approved reconciliation matches | 0 | `PASS` |
| Unbalanced accounting journals | 0 | `PASS` |
| Journals without journal lines | 309 | `REVIEW` |
| Orphan journal lines | 0 | `PASS` |
| Accounting debit/credit balance | Rp18,369,820.00 = Rp18,369,820.00 | `PASS` |
| Central Finance rows | 0 | `NOT APPLICABLE` / no rows present |

## 4. Classification notes

- The 376 completed-without-check-in rows and 360 terminal-history inconsistencies
  overlap; they are not automatically separate incidents.
- The 16 duplicate booking/payment-type groups and six reference groups must be
  classified using payment identity, provider identity, accounting, settlement,
  and invoice evidence. They must not be deleted or merged automatically.
- The 27 processing and 12 failed outbox rows require stale-lock, journal, GL,
  tax, and Central Finance evidence before any retry decision. No retry or
  requeue was performed.
- The 68 reconciliation rows are candidates only. No candidate was approved.
- `sport_expenses` exists but has no `status` column, so expense status-transition
  auditing is `UNKNOWN`, not `PASS`.

## 5. Schema architecture

| Object | Result |
|---|---|
| `sport_center.bank_reconciliation_matches` | Present and used as the canonical application candidate table |
| `public.bank_reconciliation_matches` | Present; requires separate source-identity review |
| `public.accounting_entries` | Not present |
| `public.accounting_entry_lines` | Not present |

The absence of the two public accounting tables does not establish that accounting
is missing. The Sport Center accounting tables were audited directly.

## 6. Sections with no deterministic evidence in this run

Event pricing arithmetic, recurring-date parity, reschedule-state history,
check-in timing rules, refund structures, group membership, settlement identity,
and complete cross-entity payment-to-bank-to-settlement linkage remain
`UNKNOWN`/`REVIEW` where the required source tables or authoritative evidence were
not available in the audited scope. Historical values were not rewritten.

## 7. Remediation and mutation proof

**Remediation:** `REVIEW ONLY`  
**Production changes:** none  
**Writes/DDL/maintenance:** none  
**Outbox retry/requeue:** none  
**Reconciliation approval:** none  
**Final action:** transaction rolled back
