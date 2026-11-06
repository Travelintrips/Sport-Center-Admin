# Sport Center Kasbon → Kasbon POOL automatic sync (staged)

## State
**DEV only; production writing OFF by default.** This implementation uses a
Postgres trigger to enqueue create/edit/delete events, and a 30-second worker
that processes eligible **new** entries only. Edit/delete events are retained
for reconciliation, NOT silently overwritten in Google Sheets.

## Target
- Spreadsheet: `17KtD8OSmyYo-d6jsOa6t7DMH76gjcJvdxdNSHPS_FP8`
- Tab: `Kasbon POOL`, gid `1953055393`
- November 2026 section: title A1041, headers A1042:AI1042,
  transaction rows 1043–1057, daily subtotals row 1058.
- No approved mapping for SC004/Tri yet.
- Candidate rows from the read-only audit: SC003/Robby 1047,
  SC005/Seno 1050, SC006/Mustofa 1045 (shown as 'Kabon Mustopa'),
  SC007/Sandi 1046, SC008/Dede Saefulah / Sonik 1056 (shown as 'sonic').
  Validate employee identity explicitly before configuring row mappings.

## Safety
- Existing cells are **never overwritten**, including Robby's historical
  I1047 Rp1.500.000 and Sonic I1056 Rp1.000.000.
- Only a uniquely mapped employee, existing November date column, exact
  row label, empty day cell, employee total FORMULA spanning D:AI, and daily
  total FORMULA spanning all rows 1043–1057 qualify.
- Cumulative edits, deleted transactions, duplicate same-date entries, missing
  formulas, and earlier unprocessed event versions go to needs_review.
- The ledger stores source kasbon ID and exact cell, and re-read verifies write.
- Google Sheets and PostgreSQL cannot share an atomic transaction. If write
  succeeds but ledger recording fails, the occupied-cell safeguard blocks
  any automatic retry and requires manual reconciliation.
- Concurrent human Sheets edits cannot be prevented by Google Sheets values
  APIs. A last-moment cell re-read minimizes but does not eliminate races.
  Enable only after a protected operating procedure is approved.
- No code path clears sheets, overwrites monthly records, or modifies payroll.

## DEV deployment
Apply `scripts/migrations/20261106_sc_kasbon_pool_outbox_dev.sql`
to the DEV project only (the base outbox and ledger were applied on
6 Nov 2026). Test cases:
- Insert -> one created event
- Meaningful update -> one updated event
- No-op update -> zero extra events
- Delete -> deleted event
- Transaction ROLLBACK -> no events leak

## Required deployment configuration
```env
SC_KASBON_POOL_SYNC_ENABLED=false
SC_KASBON_POOL_SPREADSHEET_ID=<environment-specific-workbook>
SC_KASBON_POOL_SHEET_GID=<actual-gid>
SC_KASBON_POOL_EMPLOYEE_ROW_MAP_JSON=<JSON mapping verified employee IDs to exact rows>
GOOGLE_SERVICE_ACCOUNT_JSON=<server-side secret>
```
For DEV, use a **different spreadsheet** from PROD. The runtime rejects
production workbook in DEV and any mismatched APP_ENV/NODE_ENV. Never commit
service-account credentials. Grant the service-account email Editor access to
the approved workbook before enablement.

Before enabling production:
1. Clone the workbook for DEV, preserving all formula cells and existing data.
2. Reconcile the historical Robby amount and the prior Sonic daily subtotal.
3. Convert needed hardcoded daily and row totals to verified covering formulas
   on an authorized copy. *The worker never changes formulas automatically.*
4. Run E2E create -> Sheets -> ledger, restart/retry, occupied cell,
   multiple records per employee/day, and editor race tests.
5. Confirm SCA-registered employee IDs and exact historical aliases/rows.
6. Apply production migration, deploy worker with ENABLED=false, then
   enable only after a read-back and rollback plan is approved.
7. Review existing Google Sheets public export permissions for payroll privacy.

This PR is not proof that automatic production Sheets writing is active.
