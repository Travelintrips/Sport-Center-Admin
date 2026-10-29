# Sport Center Payment Events — isolated DEV E2E runbook

## Verified topology (28 Oct 2026)

The Hostinger hPanel application is `sc.travelintrips.co.id` (PROD). There is no separate Sport Center DEV application. The workbook `Sport Center DEV` has spreadsheet ID `1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU`, initially with blank `Sheet1`. The two event-related variables have been added in Hostinger PROD according to the owner screenshot, but their values and effective runtime are not verified by an authenticated read.

**Never set `SHEETS_PAYMENT_EVENTS_ENABLED=true` in Hostinger PROD for this DEV test.** Never temporarily switch the production process's `APP_ENV`/`NODE_ENV` to development. Existing production `PAID` booking tabs and BizPortal journals must not be modified by the test.

## Isolation requirements

A separate authorized process/runner is required. Configure `APP_ENV=development`, `NODE_ENV=development`, `SHEETS_PAYMENT_EVENTS_ENABLED=false`, `GOOGLE_SHEETS_PAYMENT_EVENTS_DEV_SPREADSHEET_ID=1W4m_DLxlFSwUybo1cUrx4k8Mm5MSm69fIqwet5pD5cU`, and a backend service account key from an approved secret source (do not paste or commit the key). Point the DB client strictly at Supabase DEV `xssrfshdrtdfupgqwfdw`. Validate the database target before any write. Do not copy PROD session secrets or payment records into DEV.

1. Read-only probe: call the Google Sheets API `spreadsheets.get` with `fields=sheets(properties(title))` against the DEV workbook using the service account; expect an authorized response listing `Sheet1`. Record the HTTP status, spreadsheet ID and tab names only, not tokens.
2. Create the tab named `PAYMENT EVENTS OKTOBER 2026` in that **DEV workbook only**, with these headers in A1:J1: `Source Key`, `Source Type`, `Booking ID`, `Payment ID`, `Allocation ID`, `Company Invoice ID`, `Membership Payment ID`, `Payment Date WIB`, `Amount IDR`, `Validation Status`. The admin initializer must refuse non-empty tabs.
3. Run synthetic, isolated unit/adapter E2E for direct, allocation/DP/group, corporate invoice and membership source keys; confirm exactly one write and ledger `written`; retry and ambiguous timeout must not add rows. Avoid generating genuine financial records for testing.
4. Run genuine DEV E2E only after valid isolated test payment fixtures and effective backend RLS permissions exist. `booking_sheets_payment_event_config.enabled` defaults false; use future-only start timestamps and no production activation.
5. Confirm exact row and unique `source_key`, amount, payment timestamp, RLS and no BizPortal journal write. Record evidence before promoting PR #354.

This runbook does not itself enable, deploy, or grant any permission.
