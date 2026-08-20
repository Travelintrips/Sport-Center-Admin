# CF-SC-5 — Additive Settlement Rewire (Development)

Status: development-only additive change. No production cutover, production
write, destructive migration, table drop, function drop, or legacy-column
removal was performed.

## Migration

- Added nullable `sport_center.payment_settlement_batches.canonical_bank_mutation_id`.
- Added a foreign key to `public.bank_mutations(id)`.
- Added a partial index for non-null canonical links.
- Preserved `payment_settlement_batches.bank_mutation_id` and its existing FK to
  `sport_center.bank_mutations(id)`.
- The migration is idempotent and is exposed only as
  `migrate:cf-sc-5:dev`; it is not part of `migrate:prod`.

The live development catalog verifies that both mutation IDs are nullable
integers and that their foreign keys point to their respective owners.

## Projection guard

`public.bank_mutations` still invokes the existing trigger wrapper. The wrapper
now skips the projection only when both values match:

```text
source_app = 'sport_center'
source_module = 'central_finance'
```

All other rows continue to delegate to
`sport_center.project_public_bank_mutation_to_canonical(...)`. No global trigger
disable or unrelated-project change was made.

## Central settlement contract

For a single-payment central settlement, the live
`sport_center.create_payment_settlement_batch(...)` function resolves:

```text
public.bank_mutations.canonical_key =
  sport_center:payment:<paymentId>
```

It writes that ID to `canonical_bank_mutation_id` and does not require or
populate the legacy `bank_mutation_id`. The existing batch/item creation and
advisory-lock/idempotency logic remain in place.

## Development runtime proof

A confirmed payment fixture was used inside one transaction. A temporary
central-owned public mutation was inserted, the settlement batch function was
called twice, and the transaction was rolled back.

```text
CENTRAL PUBLIC MUTATION       = 1
CENTRAL SC PROJECTION         = 0
CENTRAL SETTLEMENT BATCH      = 1
CANONICAL_BANK_MUTATION_ID    = set to the public mutation ID
LEGACY BANK_MUTATION_ID       = NULL
RETRY                         = same batch ID
ACCOUNTING EFFECT             = existing posted payment journal reused;
                                proof inserted no accounting journal
TRANSACTION CLEANUP           = rollback confirmed
```

The proof demonstrates the required central invariant without leaving a
development fixture behind.

## Legacy/shadow compatibility

The legacy FK, projection function, and projection trigger remain present.
Non-central rows still pass through the original function. A synthetic
`unmatched` legacy row was intentionally not treated as a successful projection
regression: the existing projection function returns without projecting rows
outside its pre-existing matched/auto-matched settlement scope. A historical
matched fixture was not mutated for this development-only proof.

Therefore:

```text
LEGACY MODE       = wrapper compatibility preserved; full matched-fixture
                    runtime regression not claimed
SHADOW MODE       = unchanged by this additive migration; not cut over
CENTRAL MODE      = runtime proof passed
```

## Validation

```text
CF-SC-5 dev migration       = PASS
scripts typecheck           = PASS
git diff --check             = PASS
production writes           = 0
production cutover          = NO
```

The old Sport Center mutation/reconciliation surfaces remain KEEP or
LEGACY/HISTORICAL support for now. They are not safe to retire based on this
proof alone.

```text
READY FOR CENTRAL RUNTIME PROOF = YES
READY FOR SC LEGACY RETIREMENT  = NO
BLOCKERS                        = no matched historical fixture was mutated
                                  for the optional legacy runtime proof
```