# CF-SC-7C — Canonical Finance Configuration Discovery

**Environment:** DEV only  
**Run date:** 2026-08-20  
**Command:** `APP_ENV=development NODE_ENV=development pnpm --filter @workspace/scripts run cf-sc-7c:dev`

This is a read-only discovery. The command requires `SUPABASE_DATABASE_URL_DEV`,
rejects production environment variables, starts a PostgreSQL `READ ONLY`
transaction, and rolls it back. It does not seed fixtures or create/update/delete
database objects.

## Actual configuration

- **Sport Center company:** `company_id=1`, `CST`, `PT Cahaya Sejati Teknologi`.
- **Ownership:** the active facility mappings discovered for Sport Center resolve
  to company 1. Payment rows with company metadata also resolve to company 1.
- **Active settlement config:** company 1, provider `mandiri_direct`, Bank Mandiri
  CST receiving account, one-business-day settlement delay, effective 2026-08-10,
  active, source `OWNER_APPROVED`.
- **Active tax config:** `PPN_OUT_11`, type `output_vat`, rate `11.00%`,
  applies to `sport_booking`, active. No inclusive/effective-date scope was
  available beyond that row, so applicability outside that scope is not inferred.
- **COA source:** `sport_center.coa_accounts` (active COA rows were discovered).
- **Provider contract:** `mandiri_direct`, `paylabs`, and `unknown`.

No credentials, private keys, or full receiving-account numbers are included in
the report. The executable JSON output masks receiving-account identifiers.

## DEV payment inventory

| Shape | DEV rows | Classification |
|---|---:|---|
| QRIS full payment | 9 | `READY_FOR_ROLLBACK_FIXTURE` |
| Transfer full payment | 0 | `BLOCKED_CONFIG_MISSING` |
| Paylabs full payment | 0 | `BLOCKED_CONFIG_MISSING` |
| QRIS DP | 0 | `READY_FOR_ROLLBACK_FIXTURE` |
| QRIS pelunasan | 0 | `READY_FOR_ROLLBACK_FIXTURE` |
| Transfer DP | 0 | `BLOCKED_CONFIG_MISSING` |
| Transfer pelunasan | 0 | `BLOCKED_CONFIG_MISSING` |
| Group payment | 9 | `READY_FOR_ROLLBACK_FIXTURE` |
| Historical recovery | 9 | `LEGACY_ONLY` |
| Provider unknown/null | 0 | `BLOCKED_CONFIG_MISSING` |

The nine observed payment rows are `QRIS` + `mandiri_direct` +
`full_payment`. No DEV Paylabs or unknown-provider payment rows were found.

## Owner decisions required

The audit found no need to add configuration for the existing QRIS control.
Before creating transfer or Paylabs rollback fixtures, the owner must provide
evidence/configuration for:

- **Transfer Bank:** a canonical provider/settlement configuration for the
  `bank_transfer` shape.
- **Paylabs:** a canonical settlement configuration for the `paylabs` provider.
- **Unknown provider:** an explicit owner decision and canonical settlement rule;
  the audit does not treat `unknown` as safely postable.

DP and pelunasan use the existing payment-type contract and do not require a
separate settlement configuration when the payment method/provider configuration
already resolves.

## Safety result

`INSERT=0`, `UPDATE=0`, `DELETE=0`, `DDL=0`.  
`CF-SC-7C_READ_ONLY_ROLLBACK_CONFIRMED` was emitted.

The executable discovery is `scripts/src/cf-sc-7c-discovery.ts`, exposed as
`pnpm --filter @workspace/scripts run cf-sc-7c:dev`.