# Kasbon POOL — Gate Audit Integrasi Langsung

Target: existing Google Sheets workbook, tab `Kasbon POOL` (gid provided by user).

## Existing structure visible in user's screenshot (not yet API-verified)

- November 2026 marker: row 1041
- Header row: 1042
- Date grid: E=1 Nov, F=2 Nov, …, I=5 Nov (follow header, never hard-code)
- Column A: day/index; B: description/person; C: total; D: October carryover
- Transaction rows around 1043–1057; row 1058: monthly totals
- Some rows contain prior-month balances and manual transactions
- Robby 5 November has existing Rp1,500,000 in the screenshot
- Historical screenshot of Sport Center listed KB-00001 for Robby as Rp1,000,000; current DB data must be reconciled before linking

## Safe audit commands (read only)

In a server environment already authorized to access the workbook, configure:

```sh
export SC_KASBON_POOL_SPREADSHEET_ID='<workbook-id>'
export SC_KASBON_POOL_SHEET_GID='<tab-gid>'
# GOOGLE_SERVICE_ACCOUNT_JSON must be configured securely by deployment environment.
node artifacts/api-server/scripts/auditKasbonPool.mjs
```

Do not paste the service-account key into chat or commit it. The script uses
`spreadsheets.readonly` OAuth scope, requests metadata and formula/unformatted
values, and never calls any mutation API.

## Release gate (MUST all PASS before any write)

1. Live API confirms the exact workbook/tab ID and title.
2. All month sections, row bounds, total rows and protected/formula cells audited.
3. Explicit mapping of unique SC employee ID → unique POOL row per monthly section.
4. Existing manual values are reconciled, never overwritten.
5. Each kasbon source ID has a durable sync linkage and read-back verification.
6. New-entry, edit, delete, retry and concurrent-writes behavior tested on an
   isolated copy of the sheet, not production.
7. Only update a precisely selected vacant non-formula cell after optimistic
   concurrency check; if unknown, return review_required, never guess.
8. Keep current monthly totals and carry-forward formulas intact.

This PR is an audit/preflight tool, NOT a live sync worker; no Google Sheets
production write should be enabled by its merge alone.

## Live read-only audit (6 Nov 2026, exported XLSX via HTTP GET)

- Exact named tab `Kasbon POOL` exists; workbook has 13 tabs.
- 2026-11 month starts row 1041, header 1042, transactions 1043–1057, subtotal row 1058.
- C1058 formula `SUM(C1043:C1056)` returns Rp56.871.000 (matches sum C1043:C1057 today).
- D1058 formula `SUM(D1043:D1055)` returns Rp46.300.000 (matches today; range excludes two rows).
- I1045 Rp1.500.000 (Mustopa), I1047 Rp1.500.000 (Robby), I1056 Rp1.000.000 (sonic).
- I1058 is a hardcoded Rp3.000.000, but the daily entries sum Rp4.000.000. **RISK: mismatch Rp1.000.000**.
- Of the transaction-row C totals, only Roly row 1043 currently has a formula; others are manually stored numbers.
- Two labels differ from Sport Center employee master: Mustopa vs Mustofa, sonic vs Dede Saefulah / Sonik. Tri has no November row.
- Do not write until these ambiguities are reconciled and a controlled copy of the sheet passes E2E.
- Read-only reusable check: `SC_KASBON_POOL_SPREADSHEET_ID=<id> python3 artifacts/api-server/scripts/auditKasbonPoolXlsx.py`
- Any read-only export availability may depend on workbook sharing settings. Review the sharing permissions for sensitive financial information.
