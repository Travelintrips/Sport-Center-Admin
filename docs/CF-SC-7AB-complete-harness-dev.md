# CF-SC-7A/7B — Test Runner and Rollback-Only Harness

## Test runner

The runner root cause was test execution/configuration drift:

- the API package declared Jest with ESM VM modules;
- the finance boundary test imported `vitest`, which was not a declared
  workspace dependency;
- the integration fake database did not recognize the canonical
  `public.bank_mutations` upsert introduced by the current accounting path;
- the package test script did not include the serial Jest option.

The test assertions were not rewritten. The finance boundary test now uses the
repository-declared Jest API, the fake client recognizes the current SQL
contract, and the package script runs Jest with ESM and `--runInBand`.

```text
finance suites executed = 14
assertions passed       = 99
assertions failed       = 0
blocked before assert   = 0
```

## Harness

The development entrypoint is:

```text
pnpm --filter @workspace/scripts run cf-sc-7ab:dev
```

It requires `APP_ENV=development`, rejects production `NODE_ENV`, requires
`SUPABASE_DATABASE_URL_DEV`, rejects production database variables, verifies
the `sport_center` schema, and always rolls back. It creates only a temporary
fixture registry; it does not insert payment, accounting, mutation, or
settlement rows.

The current invocation verified:

```text
APP_ENV                    = development
NODE_ENV                   = development
DEV sport_center schema    = verified
active settlement configs  = 1
active tax configs         = 1
rollback                   = confirmed
```

Only `qris_full / mandiri_direct / full_payment` is marked
`CONTROL_AVAILABLE`, carried forward from CF-SC-6. All other requested shapes
remain `BLOCKED_CONFIG_MISSING` until canonical fixture rows and their
canonical configuration are available. The harness intentionally fails closed
instead of creating fake financial configuration or claiming pipeline proof
from metadata alone.

## Safety boundary

```text
real Paylabs call        = 0
WhatsApp send            = 0
PROD writes              = 0
PROD cutover             = NO
legacy cleanup           = NO
```

## Validation

```text
workspace typecheck      = PASS / 0 errors
API build                = PASS
API workflow             = RUNNING
Sport Center web         = RUNNING
git diff --check         = PASS
```

Shadow readiness remains `NO` because the remaining payment-shape matrix and
PROD read-only classification are still unavailable.