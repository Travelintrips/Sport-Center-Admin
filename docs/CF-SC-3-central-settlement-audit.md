# CF-SC-3 — Central Settlement Rewire Audit

Status: implemented in development code only. No production cutover, migration,
data backfill, destructive SQL, Paylabs charge, or WhatsApp send was performed.

## Result

- Canonical bank mutation: `public.bank_mutations`.
- Public mutation identity: `canonical_key = sport_center:payment:<sport_payments.id>`.
- Secondary idempotency key: `mutation_key = SC-PAY-<sport_payments.id>`.
- Central accounting source: `public.accounting_entries`, keyed by
  `sc_payment_<sport_payments.id>`.
- Central settlement source: the canonical public bank mutation created by the
  central payment posting transaction.
- Central reconciliation source: `public.bank_reconciliation_matches` and the
  public mutation identity. Sport Center reconciliation rows are not created by
  this path.
- Public-to-Sport-Center projection: **NO** for central payment processing.

The canonical mutation stores `source_app=sport_center`,
`source_module=central_finance`, `source_table=sport_payments`,
`source_id=<payment id>`, `owner_app=sport_center`,
`owner_company_id=<company id>`, provider metadata, linked transaction identity,
and `journal_entry_id`. The insert is idempotent on the existing public
`canonical_key` unique index and fails closed on a key collision belonging to a
different source row.

## Finance-mode behavior

- `legacy`: existing Sport Center bank mutation and downstream behavior remain
  enabled.
- `shadow`: existing legacy behavior remains enabled; the finance event remains
  available.
- `central`: legacy Sport Center bank-mutation writes are disabled. Central
  posting writes accounting and the canonical public bank mutation directly.

## Retirement classification

| Object | Classification | Reason |
|---|---|---|
| `sport_center.bank_mutations` | LEGACY_ONLY / HISTORICAL_ONLY | Existing reconciliation routes, scheduler protection, and historical rows still depend on it. |
| `sport_center.bank_reconciliation_matches` | LEGACY_ONLY / HISTORICAL_ONLY | Existing Sport Center reconciliation UI and historical links remain readable. |
| `sport_center.bank_reconciliation_account_rules` | KEEP | Legacy reconciliation configuration is still live. |
| `sport_center.bank_reconciliation_closing` | KEEP | Period closing and reporting routes still consume it. |
| `sport_center.bank_journal_entries` | LEGACY_ONLY / HISTORICAL_ONLY | Existing bank reconciliation journal projection; central accounting owns new journals. |
| `public.bank_mutations` | KEEP / CENTRAL_REQUIRED | Shared canonical identity for central settlement and reconciliation. |

The projection helper and legacy settlement helpers were not found as live
application callers in this checkout, so they were not deleted or guessed at.
Unknown or historical database functions remain untouched.

## Verification

- Canonical ownership contract test: passed (2 tests).
- API build: passed.
- API restart: passed.
- `/health`: passed.
- `/readiness`: passed with database reachable.
- `git diff --check`: passed.
- No production workflow or production database was used.

The repository's API typecheck currently has pre-existing workspace failures
(including stale `@workspace/db` build output and hundreds of implicit-`any`
diagnostics in unrelated routes). The existing payment integration test cannot
be executed by the configured Jest runner because it contains top-level
`await` transformed as CommonJS; this is an existing test-runner/configuration
issue, not a failure from the central mutation implementation.

## Runtime proof boundary

The implementation is transactionally wired and idempotent, but no controlled
payment fixture was inserted in this pass. Therefore a numeric dev-only proof
of “zero new Sport Center mutations / zero new Sport Center matches” is not
claimed here. No production data was mutated.

## Remaining blockers

The requested named settlement SQL functions and `payment_settlement_batches`
callers are not present in the checked-in API source. A database-side inventory
of those functions was not changed or dropped. A follow-up database audit is
needed before classifying any such unknown functions as safe to retire.