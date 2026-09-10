# CF-SC-7D — Ready Payment Matrix DEV Rollback

**Run:** `APP_ENV=development NODE_ENV=development SPORT_CENTER_FINANCE_MODE=central pnpm --filter @workspace/scripts run cf-sc-7d:dev`

## Proven in one rollback transaction

| Shape | Finance event | Central processing | Accounting | Public mutation | Tax ledger | Balanced | Retry |
|---|---:|---:|---:|---:|---:|---|---|
| QRIS full payment | 1 | 1 | 1 | 1 | 1 | Yes | Same identity |
| QRIS DP | 1 | 1 | 1 | 1 | 1 | Yes | Same identity |
| QRIS pelunasan | 1 | 1 | 1 | 1 | 1 | Yes | Same identity |
| Group payment | 1 | 1 | 1 | 1 | 1 | Yes | Same identity |

Combined DP + pelunasan proof:

- Payment IDs are distinct.
- Two payment-level accounting identities are created.
- Total confirmed amount is preserved.
- No booking-level accounting entry is created.
- Sport Center legacy bank mutations created: `0`.
- Public canonical bank mutations created: one per payment.

## Configuration trace

Every passing case resolved:

- Company: CST / company 1
- Payment method: QRIS
- Provider: `mandiri_direct`
- Receiving account: canonical DEV account, redacted in output
- Tax rule: `PPN_OUT_11`
- Tax rate: `11.00%`
- Settlement delay: one business day
- Classification: `CANONICAL_CONFIG`

## Remaining runtime gaps

- `payment_settlement_batches` rows created by the runtime: `0`.
  The current payment-posting path has no settlement-batch writer, so this
  harness does not manufacture one. `readyForProdShadowMode` remains `false`.
- Cross-client concurrency was not claimed inside the rollback transaction.
  Retry idempotency and the database advisory-lock path were exercised; a true
  concurrent-client proof requires committed temporary fixtures or a dedicated
  isolated database.
- Transfer Bank, Paylabs, unknown-provider, and historical-recovery shapes
  remain blocked exactly as classified by CF-SC-7C.

## Rollback and safety

- `APP_ENV=development` required.
- `NODE_ENV=production` rejected.
- `SPORT_CENTER_FINANCE_MODE=central` required.
- DEV Supabase database fingerprint verified.
- No Paylabs or WhatsApp calls.
- PROD writes: `0`.
- PROD cutover: `NO`.
- Final fixture-owned rows after rollback: `0`.
- `CF-SC-7D_ROLLBACK_CONFIRMED` emitted.

The harness is available as:

```bash
pnpm --filter @workspace/scripts run cf-sc-7d:dev
```