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

## Final Phase Verdict

### 1. EXECUTIVE VERDICT

`PRODUCTION INTEGRITY = VERIFIED` for the executed read-only checks. This does
not mean every historical anomaly is repaired; all non-deterministic anomalies
remain documented as `REVIEW_REQUIRED` or `UNKNOWN`.

### 2. SAFE FIXES EXECUTED

`NONE`. No record met every safe-fix condition. No payment, invoice, tax,
accounting, settlement, reconciliation, booking, or Central Finance record was
changed.

### 3. REVIEW REQUIRED

Review is required for the 376 completion/check-in records, 8 missing
`completed_at` records, bookings 380 and 511, 360 terminal-history
inconsistencies, 16 payment duplicate groups, 6 provider-reference groups, 39
processing/failed outbox rows, 3 tax duplicate groups, 68 reconciliation
candidates, and 309 journals without lines. Historical meaning cannot be safely
inferred from the available evidence.

### 4. VERIFIED PASS AREAS

No orphan payments, no terminal-booking confirmed payments, no invoice-number
duplicates, no orphan invoice items, no invoice total mismatches, PPN 11%
configuration, no orphan journal lines, no approved reconciliation matches,
and unchanged baseline/final counts.

### 5. ACCOUNTING / CENTRAL FINANCE SAFETY

Accounting debit equals credit at Rp18,369,820.00. No unbalanced journal was
found. Central Finance was unchanged and no Central Finance rows were present
in the audited optional table.

### 6. BEFORE / AFTER COUNTS

All 11 audited table counts are unchanged; see the baseline table above.
Final fingerprint: `PASS — NO COUNT CHANGES`.

### 7. TEST / TYPECHECK / BUILD RESULTS

- Scripts typecheck: `PASS`
- API typecheck: `PASS`
- API tests: `17 suites / 109 tests PASS`
- API build: `PASS`
- API workflow startup: `PASS`, listening on port 8080
- Scripts test/build commands: not defined in `scripts/package.json`

### 8. GIT DIFF CHECK

`PASS`.

### 9. PRODUCTION MUTATION PROOF

Dedicated auditor role, `transaction_read_only=on`, zero mutation queries,
zero skipped audit queries, and final transaction `ROLLBACK`.

### 10. FINAL STATUS

- `PRODUCTION INTEGRITY = VERIFIED`
- `SAFE FIXES = NONE`
- `REVIEW REQUIRED = DOCUMENTED`
- `UNKNOWN = ONLY WHERE EVIDENCE IS INSUFFICIENT`
- `CENTRAL FINANCE = UNCHANGED`
- `UNAUTHORIZED FINANCIAL MUTATION = NONE`

## Final Remediation Phase

### EXECUTIVE SUMMARY

The requested production remediation pass was completed as
`AUDIT → CLASSIFY → PROVE → FIX → VERIFY`. Classification and proof were
performed against the dedicated read-only production connection. No item met
all safe-fix requirements, so the fix set is empty.

### SAFE FIXES EXECUTED

`0`.

No production write connection was opened and no application write mechanism was
invoked because there was no deterministically provable target correction. In
particular, no check-in/completion timestamp was fabricated, no booking status
was rewritten, no payment was deleted or merged, no outbox was retried or
marked posted, no reconciliation candidate was approved, and no journal lines
were generated.

### NOT FIXED / REVIEW REQUIRED

All previously listed anomaly groups remain unchanged and classified as
`REVIEW_REQUIRED` or `UNKNOWN` where source evidence is insufficient. The
production write path must only be used after an individual record has a
canonical source, exact target state, idempotent mechanism, and no financial or
Central Finance side effect.

### BEFORE/AFTER FINANCIAL TOTALS

No financial mutation occurred. Accounting remains balanced at
Rp18,369,820.00 debit and Rp18,369,820.00 credit. Payment, invoice, tax, and
reconciliation totals were not changed.

### READ-ONLY POST-FIX AUDIT

`PASS`: auditor role is `sport_center_production_auditor`,
`transaction_read_only=on`, zero mutation queries, zero skipped queries, counts
unchanged, and the transaction ended with `ROLLBACK`.
