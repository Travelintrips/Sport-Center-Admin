# Kasbon POOL — per-month automatic row discovery (DEV staged)

## Goal
The production environment must **not** need a JSON row mapping for each employee
and must **not** be edited each month/year. The Google Sheets connection
(spreadsheet ID, sheet gid, service-account secret) remains stable.

## Algorithm
1. Consume an outbox event with stable `employee_id`, date, amount.
2. Read a verified exceptional alias from
   `sport_center.sc_kasbon_pool_employee_mapping`. Otherwise use the employee
   master full name and match only exact full names (with optional `Kasbon `
   prefix), not fuzzy partial text.
3. Read the live `Kasbon POOL` sheet metadata and values. Identify the target
   monthly block from the **year/month/day header**, not from fixed November
   2026 row numbers.
4. Find exactly one matching employee label within the monthly block. Reject
   missing/duplicate labels, missing months or ambiguous dates.
5. Check target cell is truly empty and subtotals reconcile. Update the empty
   transaction cell and only verified subtotal formulas in a batch, then read
   back transaction, employee, day and month totals.
6. Ledger records `kasbon_id -> exact cell`; retries cannot duplicate the
   same transaction.

## Alias examples
- SC003 Robby → `Kasbon Robby`: automatic exact match, no alias needed.
- SC005 Seno → `Kasbon SENO`: automatic exact match.
- SC007 Sandi → `Kasbon sandi`: automatic exact match.
- SC008 Dede Saefulah / Sonik → `sonic`: verified one-time alias.
- SC006 Mustofa / Mustopa: **not verified**; do not assume identical person.
- SC004 Tri: **no established row** in November 2026.

## Environment
`SC_KASBON_POOL_EMPLOYEE_ROW_MAP_JSON` is no longer used by the new worker.
The existing Google Sheets ID, gid, service-account and enabled flag still apply.
No monthly ENV edits.

## Important safeguards
- Only existing month sections are auto-discovered. Creating a missing December
  or January section (including styling and cross-month carryover) is **not**
  authorized by this implementation; event marked `needs_review` safely.
- No bulk rewriting of historical data. Never overwrite an occupied day cell.
- Multiple same-day kasbons for the same employee require a separate audited
  aggregation protocol; do not overwrite the previous amount.
- Existing edit/delete sync remains `needs_review`, not silently applied.
- A new month is accepted only if the expected month header, date and unique
  employee label exist in the live sheet.
- E2E authorized Sheets DEV-copy write/readback is required before PROD deployment.

## Verification performed
- Dynamic month discovery: November 2026, December 2026, January 2027 PASS
  (synthetic exact header/row cases).
- Missing month, duplicate name, unknown employee, invalid date: blocked.
- Full subtotal planning and short-formula rejection PASS on synthetic month.
- Database mapping foreign key & rollback transaction PASS in DEV.
- Backend TypeScript build/typecheck PASS.
- PROD not touched by these code changes; existing worker continues until a
  separately validated deployment.

## Read-only audit of the real workbook (6 November 2026)
- Latest month section found: **November 2026 at row 1041**. Previous month titles: September at row 997, October at row 1019.
- **No December 2026 or January 2027 section is present** in the current workbook export.
- Live November preview of existing Robby KB-00003: target I1047 remains empty; this dynamic planner identifies row 1047, day column I, employee subtotal C1047, monthly subtotal C1058. Dry-run only: no Sheets changes.
- A fully automatic rollover to December would require an explicit template/carryover policy. Copying last month's opening balance without payroll rules is unsafe, so auto-creating future month sections is not enabled by this PR.
- The monthly ENV JSON map may remain temporarily in Hostinger, but the new dynamic worker **does not read it**. After a verified deployment, it is redundant.
