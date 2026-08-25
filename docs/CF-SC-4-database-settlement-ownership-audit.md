# CF-SC-4 — Database-only Settlement Function Ownership Reconciliation

Status: development read-only audit. No production write, development write,
DROP, function replacement, trigger replacement, or schema mutation was
performed.

## Central path

- Central payment owner: `artifacts/api-server/src/lib/centralFinance.ts`.
- Canonical bank mutation owner: `public.bank_mutations`.
- Canonical payment key: `sport_center:payment:<paymentId>`.
- The application central path does not call
  `project_public_bank_mutation_to_canonical()` and does not insert into
  `sport_center.bank_mutations`.
- This does **not** yet prove zero projection at runtime because the
  development database has an automatic public-bank trigger described below.

## Function inventory

| Function | Development finding | Classification | Central mode |
|---|---|---|---|
| `sport_center.create_payment_settlement_batch(...)` | `SECURITY DEFINER`, `public` EXECUTE granted; writes `payment_settlement_batches` / items and uses Sport Center settlement tables | LIVE_RPC/API | Not required by the payment accounting worker; still coupled to SC batch schema |
| `sport_center.create_payment_settlement_batch_legacy(...)` | `SECURITY DEFINER`, public EXECUTE revoked; legacy batch implementation | LEGACY_COMPATIBILITY | Not required |
| `sport_center.create_settlement_journal_draft(...)` | `SECURITY DEFINER`, public EXECUTE revoked; creates SC accounting journal draft | LEGACY_COMPATIBILITY | Not required |
| `sport_center.finalize_payment_settlement_legacy(...)` | `SECURITY DEFINER`, public EXECUTE revoked; finalizes SC settlement journal | LEGACY_COMPATIBILITY | Not required |
| `sport_center.find_settlement_bank_candidates(...)` | `SECURITY DEFINER`, public EXECUTE revoked; reads and inserts/updates SC bank-mutation candidate data | UNKNOWN / LEGACY_COMPATIBILITY | Not required |
| `sport_center.mark_settlement_payments_settled(...)` | `SECURITY DEFINER`, public EXECUTE granted; mutates SC payment settlement state | LIVE_RPC/API | Not required by central payment accounting |
| `sport_center.project_public_bank_mutation_to_canonical(...)` | `SECURITY DEFINER`, public EXECUTE granted; reads public mutation and creates SC projection | LIVE_RPC/API / LEGACY_COMPATIBILITY | Must not be called for central-owned mutations |
| `sport_center.project_public_bank_mutation_to_canonical_trigger()` | Trigger wrapper; invokes the projection function | LIVE_DB_TRIGGERED | **BLOCKER** until it skips central-owned mutations |
| `sport_center.recover_posted_settlement_from_bank_mutation(...)` | `SECURITY DEFINER`, public EXECUTE granted; reads public mutation and creates/updates SC recovery rows | LIVE_RPC/API / LEGACY_COMPATIBILITY | Not required |
| `sport_center.replay_public_bank_mutation_bridge(...)` | Calls the projection function directly | LIVE_RPC/API / LEGACY_COMPATIBILITY | Must not be used |
| `sport_center.guard_settlement_items(...)` | Exact name not present in the development inventory; related `guard_finalized_settlement_items` trigger function exists | UNKNOWN | Do not retire |

Additional settlement helpers found in development include
`canonical_settlement_group_identity`,
`create_payment_settlement_supplemental_batch`,
`calculate_settlement_mdr`, and
`resolve_payment_settlement_config`. They are settlement support objects, not
the public-bank projection itself, and remain KEEP/UNKNOWN until caller
ownership is proven.

## Live database trigger

Development contains:

```text
public.bank_mutations
  AFTER INSERT OR UPDATE OF mutation_key, company_id, transaction_date,
  amount, direction, status
  → sport_center.project_public_bank_mutation_to_canonical_trigger()
  → sport_center.project_public_bank_mutation_to_canonical(NEW.id)
```

This is the direct database-only dependency that defeats a source-only claim
of zero Sport Center mutations. The trigger function has no central-mode
guard and no source ownership exception.

Other live settlement triggers:

- `sport_center.trg_guard_posted_settlement_batch`
- `sport_center.trg_settlement_payment_state_after_post`
- `sport_center.trg_guard_finalized_settlement_items`

They protect settlement state and do not themselves project public bank
mutations.

## FK/schema ownership

The development database has these relevant foreign keys:

- `sport_center.payment_settlement_batches.bank_mutation_id`
  → `sport_center.bank_mutations.id`
- `sport_center.bank_journal_entries.mutation_id`
  → `sport_center.bank_mutations.id`
- `sport_center.bank_reconciliation_matches.mutation_id`
  → `sport_center.bank_mutations.id`
- Public `bank_journal_entries`, `bank_reconciliation_matches`,
  `payment_allocations`, and `qris_mutation_batch_candidates` already reference
  `public.bank_mutations.id`.

To eliminate the SC projection later, the additive schema direction is:

1. Add nullable `canonical_bank_mutation_id` to
   `sport_center.payment_settlement_batches` with an FK to
   `public.bank_mutations(id)`.
2. Make central settlement functions read/write the canonical column.
3. Keep `bank_mutation_id` for legacy and historical rows.
4. Add an ownership guard to the public projection trigger so
   `source_app='sport_center'` plus `source_module='central_finance'` is not
   projected.
5. Only after a successful cutover, classify the old FK and projection path as
   SAFE_TO_RETIRE_LATER. No DROP is approved in this phase.

## Final report

```text
CENTRAL PAYMENT PATH = payment_confirmed finance event → public accounting → public bank mutation
CENTRAL BANK MUTATION OWNER = public.bank_mutations
DB-ONLY SETTLEMENT FUNCTIONS = create_payment_settlement_batch, supplemental batch helpers,
  mark_settlement_payments_settled, public-bank projection/recovery bridge
LIVE FUNCTIONS = create_payment_settlement_batch, mark_settlement_payments_settled,
  project_public_bank_mutation_to_canonical, recovery function, replay bridge
LEGACY-ONLY FUNCTIONS = create_payment_settlement_batch_legacy,
  create_settlement_journal_draft, finalize_payment_settlement_legacy
UNKNOWN FUNCTIONS = find_settlement_bank_candidates, exact guard_settlement_items name
CENTRAL DEPENDENCY ON SC BANK MUTATIONS = application: NO; database trigger: YES
SCHEMA/FK REWIRE REQUIRED = YES, additive canonical_bank_mutation_id plus trigger guard
SAFE_TO_RETIRE_LATER = projection/recovery bridge and SC mutation FKs, only after cutover proof
BLOCKERS = unguarded public.bank_mutations projection trigger; no controlled fixture run
READY FOR CENTRAL SETTLEMENT RUNTIME PROOF = NO
```

## Source-level guards

The existing focused test verifies that the central application path references
the canonical public mutation writer and does not contain the legacy SC
projection write. That test cannot prove database trigger behavior; the
database trigger audit above is therefore intentionally a separate blocker.