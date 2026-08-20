# CF-SC-7 — Payment Matrix and PROD Shadow Readiness

Status: DEV inventory and rollback-only harness assessment completed. PROD
read-only classification and shadow comparison are blocked because this
workspace has no production database endpoint. No production write or
cutover was performed.

## CF-SC-6 baseline carried forward

The QRIS `full_payment` proof for payment 92 remains valid:

```text
finance event                 = posted
central processing            = posted
accounting                    = posted
tax                           = posted
public.bank_mutations         = 67
sport_center.bank_mutations   = 0
settlement batch              = 15
settlement retry              = 15
gross / net                   = 100000.00 / 99700.00
canonical mutation FK         = populated
legacy mutation FK            = NULL
rollback                      = confirmed
```

## DEV payment matrix inventory

This is a read-only inventory of the available DEV rows. No synthetic payment
row was inserted to claim coverage for a missing shape.

```text
QRIS full_payment / mandiri_direct = 9 rows
Transfer Bank full_payment        = 0
Paylabs full_payment              = 0
QRIS DP                           = 0
QRIS pelunasan                    = 0
Transfer Bank DP                  = 0
Transfer Bank pelunasan           = 0
group payment                     = 0 representative rows
provider unknown                  = 0
```

The DEV database has one active settlement configuration:

```text
company              = 1
provider             = mandiri_direct
bank account         = 1640006707220
effective from       = 2026-08-10
tax rule              = PPN_OUT_11
tax rate              = 11.00
settlement source    = OWNER_APPROVED
```

Therefore only the QRIS full-payment shape is runtime-proven. The remaining
matrix rows are `BLOCKED_FIXTURE_MISSING`, not passed by inference.

## Coverage classification

```text
TRANSFER BANK        = BLOCKED_FIXTURE_MISSING
PAYLABS              = BLOCKED_FIXTURE_MISSING
DP                   = BLOCKED_FIXTURE_MISSING
PELUNASAN            = BLOCKED_FIXTURE_MISSING
GROUP PAYMENT        = BLOCKED_FIXTURE_MISSING
ADOPTION             = PASS via CF-SC-6 payment 92 recovery/adoption
HISTORICAL RECOVERY  = BLOCKED_FIXTURE_MISSING
PROVIDER UNKNOWN     = BLOCKED_FIXTURE_MISSING

PAYMENT MATRIX PASS COUNT    = 1 shape
PAYMENT MATRIX BLOCKED COUNT = 9 requested shapes
```

The existing CF-SC-6 proof also established the central invariants for the
passing shape: one event identity, one central processing identity, one
accounting effect, balanced accounting, one canonical public mutation, zero
Sport Center mutation, and idempotent settlement retry.

## Paylabs, DP, pelunasan, and group policy

No external Paylabs call was made. No controlled Paylabs callback fixture is
available in DEV, so provider identifier preservation is not claimed.

No DP or pelunasan rows are present. Separate payment identity remains a code
and schema requirement, but runtime coverage is blocked rather than simulated.

No group rows are present. No group-payment duplicate or source-identity claim
is made.

## PROD read-only classification

```text
PROD database endpoint       = unavailable in this workspace
known 351-event classification = BLOCKED
15 adoption classification     = BLOCKED
29 recovery classification     = BLOCKED
PROD shadow sample             = BLOCKED
shadow mismatches              = NOT CLASSIFIED
```

The previously known counts are not reclassified without the production
read-only source. No production data was queried or mutated.

## Hardcoded configuration and legacy boundary

The available successful DEV path resolved company, provider, bank account,
tax, and settlement values from database configuration. No new hardcoded
financial configuration was introduced by this proof.

Legacy Sport Center bank/reconciliation objects remain present and untouched.
No cleanup, projection disablement, destructive migration, or cutover was
performed.

## Quality gate

```text
pre-CF-SC-7 typecheck       = PASS / 0 errors
post-CF-SC-7 typecheck      = PASS / 0 errors
API build                   = PASS
git diff --check            = PASS
API workflow                = RUNNING
Sport Center web workflow   = RUNNING
test assertions             = 99 PASS
test suites                 = 14 PASS, 0 blocked before assertions
harness guard               = PASS (APP_ENV=development, DEV schema verified)
harness transaction         = PASS (rollback confirmed)
PROD writes                 = 0
PROD cutover                = NO
```

## Readiness decision

```text
READY FOR PROD SHADOW MODE       = NO
READY FOR CONTROLLED CUTOVER     = NO
READY FOR LEGACY CLEANUP         = NO
BLOCKERS                         = missing DEV payment-shape fixtures and
                                   unavailable PROD read-only database endpoint
```
