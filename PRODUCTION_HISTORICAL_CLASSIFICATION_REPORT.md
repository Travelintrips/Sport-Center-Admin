# Sport Center — Production Historical Classification Report

## Executive status

**Historical classification: BLOCKED**
**Production record-level access: BLOCKED**
**Production data mutation: NONE**

This report is intentionally conservative. The supplied production baseline
contains aggregate counts and identifies bookings `380` and `511`, but it does
not contain the record-level rows required to classify every payment,
outbox item, reconciliation candidate, recurring booking, and completion
anomaly. The live production database for this project is the separately
deployed GAE/Supabase environment; the configured Replit database is the
isolated development database and must not be used as a production proxy.

The official production Secret Manager bootstrap was requested but was not
provided, so a dedicated production PostgreSQL audit connection could not be
established. No production transaction was started, and no production data was
read or changed during this phase. Therefore, unknown records remain
`UNKNOWN`/`BLOCKED` instead of being inferred from aggregate counts.

Required blocker resolution: provide the authorized
`GCP_SECRET_MANAGER_BOOTSTRAP_JSON` through the workspace secret flow, with
the production project and secret identifiers, then rerun the dedicated
read-only gate: `BEGIN; SET TRANSACTION READ ONLY; SHOW transaction_read_only;`
The expected value is `on`. Do not substitute `DATABASE_URL`, the development
database, or the application write-capable pool.

## Verified baseline supplied for this audit

| Area | Count | Classification status |
|---|---:|---|
| Completed without check-in | 376 | Record-level evidence unavailable |
| Completed without `completed_at` | 8 | Record-level evidence unavailable |
| Future completed bookings | 2 (`380`, `511`) | Exact path unavailable |
| Duplicate payment groups | 16 groups / 32 rows | Record-level evidence unavailable |
| Confirmed/completed without confirmed payment | 70 | Record-level evidence unavailable |
| Outbox posted | 323 | Baseline only |
| Outbox processing | 27 | Record-level evidence unavailable |
| Outbox failed | 12 | Record-level evidence unavailable |
| Reconciliation candidates | 68 | Record-level evidence unavailable |
| Production mutation | 0 | Verified by task constraints |

## Record-level classification

### Future completed bookings

| ID | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---:|---|---|---|---|---|---|
| 380 | UNKNOWN / BLOCKED | Baseline identifies it as future `completed`; no production row, history, audit, payment, invoice, group, or reschedule evidence supplied | Cannot identify exact historical writer without production read-only evidence | UNKNOWN | No | Read the booking row and all related history/audit/payment records in a verified read-only production transaction |
| 511 | UNKNOWN / BLOCKED | Baseline identifies it as future `completed`; no production row, history, audit, payment, invoice, group, or reschedule evidence supplied | Cannot identify exact historical writer without production read-only evidence | UNKNOWN | No | Same controlled read-only evidence collection as booking 380 |

### Completed without check-in — 376 records

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| 376 completed bookings | UNKNOWN / BLOCKED | Only aggregate count supplied; no IDs or per-record check-in/history/audit evidence supplied | Current code now requires `confirmed`, `checkedInAt`, elapsed end time, and no pending reschedule; historical writer cannot be proven from the aggregate | UNKNOWN | No | Export IDs and related booking history, audit, QR check-in, scheduler, admin, WhatsApp, invoice, and lifecycle evidence; classify individually |

### Completed without `completed_at` — 8 records

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| 8 completed bookings | UNKNOWN / BLOCKED | Only aggregate count supplied; no IDs or completion-history rows supplied | Likely legacy/direct status mutation, but not proven per record | UNKNOWN | No | Compare each row with completion history and audit evidence; do not backfill automatically |

### Payment duplicates — 16 groups / 32 rows

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| 16 duplicate groups / 32 payment rows | UNKNOWN / BLOCKED | No payment IDs, booking IDs, types, amounts, provider references, correlation IDs, timestamps, or accounting links supplied | Cannot distinguish DP/final, retry, provider duplicate, or technical duplicate from count alone | UNKNOWN | No | Read and classify each group using payment identity, provider identity, accounting, settlement, and invoice evidence; do not delete or merge |

The current application contract distinguishes DP and pelunasan by payment
identity and payment type. The current confirmation guard prevents
confirmation against terminal bookings. This is code evidence, not historical
classification evidence.

### Bookings without confirmed payment — 70 records

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| 70 confirmed/completed bookings | UNKNOWN / BLOCKED | No booking IDs or payer, company, invoice, billing-status, and payment rows supplied | Corporate billing can legitimately lack direct per-booking confirmed payment; absence alone is not anomalous | UNKNOWN | No | Join booking → payer/company → invoice/items → payment → billing status and classify each record |

### Outbox — 27 processing / 12 failed

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| 27 processing rows | UNKNOWN / BLOCKED | No payment IDs, lock timestamps, attempts, errors, journal links, or Central Finance rows supplied | Could be active, stale, already posted, or incomplete | UNKNOWN | No | Read each row with lock age, payment, correlation, journal, GL, tax, and Central Finance evidence; do not retry |
| 12 failed rows | UNKNOWN / BLOCKED | No payment IDs, errors, attempts, or accounting evidence supplied | Could be safe retry, permanent configuration failure, missing payment, or already posted | UNKNOWN | No | Classify each row from canonical evidence; do not change status or requeue |

Current code uses payment-level identity, correlation IDs, bounded retries,
stale-lock recovery, existing journal detection, and Central Finance
idempotency. Those safeguards do not prove the historical state of the 39
rows.

### Reconciliation — 68 candidates

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| 68 candidate rows | AMBIGUOUS / BLOCKED | No candidate IDs, mutation IDs, payment IDs, amounts, dates, source values, or duplicate-match evidence supplied | Runtime code uses `sport_center.bank_reconciliation_matches`; the reported `candidate_source` column is absent from the current schema | UNKNOWN | No | Read both candidate tables and schema metadata in the verified production environment; establish canonical table/source identity before approval |

No migration, row copy, or candidate approval was performed.

### Recurring bookings

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| All recurring history | UNKNOWN / BLOCKED | No recurring booking IDs or related group rows supplied | Current creation path validates dates, hours, duplicates, conflicts, blocked schedules, corporate approval, payment, and lifecycle; historical parity is unproven | UNKNOWN | No | Export recurring groups and compare each session with single-booking rules |

### Cross-entity relationships

| Record set | Classification | Evidence | Root cause | Financial impact | Safe to auto-fix? | Recommended action |
|---|---|---|---|---|---|---|
| Booking → payment → invoice → settlement → reconciliation → accounting | UNKNOWN / BLOCKED | No joined production rows supplied | Corporate billing and group payments make absence of one direct edge potentially legitimate | UNKNOWN | No | Classify each relationship as required, optional, not applicable, duplicate, mismatch, or unknown using validated ownership evidence |

## Current code evidence

- Completion is routed through `completeBooking()` for scheduler, admin, and
  WhatsApp completion.
- Completion requires confirmed status, check-in, elapsed end time, and no
  pending reschedule, then writes status, `completed_at`, and history
  atomically.
- Payment confirmation now rejects non-confirmable booking states and skips
  non-confirmable group siblings.
- Regular and recurring Event pricing share one integer-safe 21.4% helper.
- Outbox and Central Finance processing use payment identity and correlation
  idempotency; no second accounting path was introduced.
- Reschedule approval rechecks conflicts in a transaction and clears
  check-in/completion timestamps for the new session.

## Safe read-only evidence query plan

Run only against the verified production connection, inside a transaction with
`SHOW transaction_read_only` returning `on`, and end with `ROLLBACK`:

1. Export all 16 duplicate groups with payment/provider/accounting/settlement
   identity fields.
2. Export the 70 booking/payment/invoice/company joins.
3. Export all processing and failed outbox rows with journal, GL, tax, public
   entry, and Central Finance linkage.
4. Export all 68 reconciliation candidates with source and mutation identity,
   and compare `sport_center` versus `public` schemas.
5. Export recurring group/session rows and all completion anomalies with
   history/audit evidence.
6. Reconcile debit and credit totals and payment/correlation uniqueness.

This plan contains no INSERT, UPDATE, DELETE, DDL, migration, retry, requeue,
approval, posting, or repair operation.

## Final verdict

- **PRODUCTION RECORD-LEVEL ACCESS:** BLOCKED — the authorized Secret Manager bootstrap was not provided, so the dedicated production connection could not be established
- **HISTORICAL CLASSIFICATION:** BLOCKED — required record-level production evidence was not safely reachable
- **BOOKING LIFECYCLE:** CLASSIFIED at code level; historical rows blocked
- **PAYMENT DUPLICATES:** UNKNOWN / BLOCKED
- **MISSING PAYMENT:** UNKNOWN / BLOCKED
- **OUTBOX:** UNKNOWN / BLOCKED
- **RECONCILIATION:** AMBIGUOUS / BLOCKED
- **RECURRING:** UNKNOWN / BLOCKED
- **CROSS-ENTITY:** UNKNOWN / BLOCKED
- **CENTRAL FINANCE:** SAFE at code level; historical linkage blocked
- **PRODUCTION DATA MUTATION:** NONE
- **CODE REMEDIATION:** PASS
- **TESTS:** 17 suites / 109 tests PASS
- **TYPECHECK:** PASS
- **BUILD:** PASS
- **GIT DIFF CHECK:** PASS