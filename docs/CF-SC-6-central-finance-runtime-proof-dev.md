# CF-SC-6 — Central Finance Runtime Proof

Status: development proof completed for the available DEV payment path.
Production shadow/cutover was not activated.

## Environment gate

```text
APP_ENV                      = development (proof invocation)
NODE_ENV                    = development
SPORT_CENTER_FINANCE_MODE   = central
database                    = SUPABASE_DATABASE_URL_DEV
production writes           = 0
```

The API workflow also confirmed that development uses the isolated DEV
database. The production read-only database endpoint is unavailable because
this Repl has no deployed production database, so production classification
and shadow comparison were not claimed.

## DEV path proof

The available representative DEV data contains QRIS / `mandiri_direct` /
`full_payment` payments. Payment 92 was used as the recovery/adoption case.
It already had a posted accounting entry and therefore did not rewrite the
historical entry.

```text
payment confirmed event       = 1
central processing identity   = 1
outbox status                 = posted
central processing status     = posted
accounting entry              = 1, posted
GL total debit / credit       = 100000.00 / 100000.00
tax transaction               = 1
public GL tax line            = not independently queryable in this DEV
                                schema because entity_id is text-shaped
public bank mutation          = 1
canonical key                 = sport_center:payment:92
Sport Center bank mutation    = 0
```

The recovery initially exposed two real defects in the central path:

1. Re-adopting an existing accounting entry used the same PostgreSQL parameter
   for integer `source_id` and `source_payment_id` without explicit casts.
2. The canonical mutation writer used `ON CONFLICT (canonical_key)` while DEV
   has a partial unique index with `WHERE canonical_key IS NOT NULL`.

Both were fixed. The adoption path now also ensures the canonical public
mutation before returning `alreadyPosted`.

## Settlement proof

Inside a rollback transaction, the settlement function was called twice for
payment 92:

```text
first batch                  = 15
retry batch                  = 15
batch status                 = calculated
gross amount                 = 100000.00
net settlement               = 99700.00
canonical_bank_mutation_id   = 67
legacy bank_mutation_id      = NULL
active settlement items      = 1
Sport Center mutations       = 0
rollback                     = confirmed
```

The net amount is produced by the existing settlement configuration and was
not hardcoded by the proof.

## Configuration and tax

The available DEV configuration resolved to:

```text
company                     = 1
provider                    = mandiri_direct
receiving account            = 1640006707220
settlement config source     = OWNER_APPROVED
settlement effective date   = 2026-08-10
tax rule                    = PPN_OUT_11
tax rate                    = 11.00
tax applies to              = sport_booking
```

Accounting remained balanced and the existing posted tax row was preserved.
No historical posted entry was rewritten.

## Idempotency and reconciliation readiness

- Outbox identity remains unique per payment/event.
- Central processing identity remains unique per source payment/event.
- Canonical mutation identity is payment-scoped and now matches the live
  partial unique index.
- Settlement retry returned the same batch ID.
- Central flow created no `sport_center.bank_mutations`.
- Central flow created no Sport Center reconciliation match.
- The public mutation contains the canonical identity needed by the public
  reconciliation surface.

The prior CF-SC-5 rollback proof also verified the central projection guard:
one central public mutation produced zero Sport Center projection rows.

## Matrix and failure-state coverage

The current DEV database does not contain representative Transfer Bank,
Paylabs, DP, pelunasan, group, or provider-unknown central fixtures. Those
cases remain unclaimed rather than being simulated with misleading labels.

The code-level failure policy was reviewed:

```text
deterministic config errors = manual_review
transient errors             = failed with backoff/retry
claim concurrency            = FOR UPDATE SKIP LOCKED
```

No new failure fixture was written to production or used to bypass
validation. The existing nine failed DEV events were not bulk-reprocessed;
only payment 92 was explicitly requeued and recovered after the fixes.

## Production and legacy classification

```text
PROD MODE                   = not changed; no production database available
PROD WRITES                 = 0
PROD CUTOVER                = NO
PROD 351-event audit        = BLOCKED: no production database endpoint
29-payment readiness        = BLOCKED: no production database endpoint
shadow comparison          = BLOCKED: no production database endpoint
legacy objects              = KEEP_FOR_LEGACY / HISTORICAL_ONLY
legacy cleanup              = NO
controlled cutover          = NO
```

## Validation

```text
central mutation test       = PASS (3 tests)
API build                   = PASS
scripts typecheck           = PASS
API typecheck               = PASS after building project references
lib/db project build        = PASS
git diff --check             = PASS
workspace typecheck         = PASS (0 errors)
pre-CF-SC-6 baseline        = PASS (0 errors)
post-CF-SC-6 typecheck      = PASS (0 errors)
API workflow                = RUNNING
Sport Center web workflow   = RUNNING
```

```text
READY FOR PROD SHADOW MODE  = NO
READY FOR CONTROLLED CUTOVER= NO
READY FOR LEGACY CLEANUP    = NO
PROD WRITES                 = 0
PROD CUTOVER                = NO
LEGACY CLEANUP              = NO
BLOCKERS                    = production database unavailable; representative
                             DEV payment matrix incomplete
```