# Sport Center — Final Production Closure Report

Date: 2026-08-23 (Asia/Bangkok)

## Executive Verdict

**PROJECT STATUS = NOT YET FINALIZED**

The codebase passes the required development checks, public production smoke endpoints respond successfully, and the dedicated production read-only audit completed with the expected auditor role and `transaction_read_only=on`. Final closure cannot be declared because official deployment metadata still reports no active deployment, and the production audit contains historical anomalies requiring review rather than unsafe cleanup. No production data was mutated during this phase.

## Production Runtime

**PASS WITH REVIEW**

- The managed API workflow is running and Secret Manager bootstrap passes.
- The known production domain `https://sc.travelintrips.co.id` responded with HTTP 200 for the homepage and API health.
- The official deployment metadata reported `isDeployed=false`, with no primary URL. This conflicts with the reachable custom domain and must be resolved in the Publishing/deployment surface before closure.
- The local web workflow is running on its configured port and the homepage screenshot rendered successfully. The browser reported one 401 resource response, so authenticated admin resource health was not proven by the non-destructive public smoke test.
- Public content routes respond through the existing trailing-slash redirect and are reachable at the redirected URL.

## Database

**PASS WITH REVIEW**

- The application is configured to use Supabase database configuration loaded by the official Secret Manager loader.
- The dedicated `sport_center_production_auditor` connection passed the required read-only handshake: `transaction_read_only=on`, server port 5432, and `ROLLBACK` completed.
- The integrity audit completed with zero mutation queries, no skipped queries, and matching baseline/final counts: bookings 429, payments 374, booking history 1,231, payment outbox 363, invoices 4, invoice items 40, journals 381, journal lines 211, bank mutations 0, reconciliation matches 68, and tax transactions 1,134.
- Required Sport Center tables are present. The optional public accounting tables were not present.
- Historical findings remain classified for review and were not rewritten: completed-booking/history inconsistencies, duplicate booking/payment-type rows, duplicate provider-reference groups, processing/failed outbox rows, orphan reconciliation matches, duplicate tax references, journals without lines, and the existing expense schema classification mismatch.
- No Replit database was substituted for the production database.

Audit result: `PASS — NO COUNT CHANGES`; the transaction ended by `ROLLBACK`.

## Storage

**PASS WITH REVIEW**

Production API responses expose Supabase Storage URLs for configured assets. No storage mutation was performed. A complete bucket-by-bucket production audit was not available without the production Supabase audit connection.

## Payment

**PASS WITH REVIEW**

- Payment method editing uses the dedicated metadata endpoint:
  `PATCH /api/payments/{id}/metadata`.
- The endpoint is admin-protected and has an allowlist for metadata fields.
- QRIS is normalized to `mandiri_direct`; non-QRIS methods use the canonical `unknown` provider.
- Financial/status fields are rejected.
- Confirmed payment corrections retain accounting guards and do not create a duplicate payment or journal.
- Regression validator tests passed: **21/21**.
- Full API test suite passed: **17 suites, 109 tests**.
- A live write-path edit was intentionally not executed because production mutation is prohibited. The read-only audit found zero orphan payments and zero confirmed payments attached to terminal bookings.

## Booking

**PASS WITH REVIEW**

Existing lifecycle and transition regression coverage passed as part of the full API suite. No historical booking was changed. A complete production row-level integrity audit remains blocked by the database limitation above.

## Corporate Billing

**PASS WITH REVIEW**

The existing implementation and available regression checks remain intact. Production invoice/payment population was not directly audited because the required Supabase read-only connection was unavailable.

## Invoice

**PASS WITH REVIEW**

The existing document routes and storage configuration remain intact. No production documents were changed. Complete production template and bucket verification remains pending.

## Tax

**PASS WITH REVIEW**

The existing canonical tax implementation and regression coverage remain intact. Historical tax transactions were not rewritten. Production ledger balance verification remains blocked by the database limitation.

## Event

**PASS WITH REVIEW**

The existing shared discount implementation and available tests remain intact. No historical event booking was created or modified.

## Recurring

**PASS WITH REVIEW**

The existing date, conflict, approval, payment, cancellation, and reschedule paths remain covered by the current code/tests. No historical recurring booking was created.

## Check-in

**PASS WITH REVIEW**

Existing authorization, timing, duplicate protection, and history paths remain intact. No production check-in was created.

## Reschedule

**PASS WITH REVIEW**

Existing validation, conflict, approval, atomic update, and history behavior remain intact. No production reschedule was created.

## Accounting

**PASS WITH REVIEW**

- API typecheck and build passed.
- Existing payment-level idempotency and outbox/journal paths remain intact.
- No accounting entry was manually created.
- Production audit found zero unbalanced journals and zero orphan journal lines. It also found 309 historical journals without lines and 39 processing/failed outbox rows; these require review and were not modified.

## Reconciliation

**PASS WITH REVIEW**

No candidate was approved and no historical reconciliation was modified. Production audit found no duplicate reconciliation candidates, but found 68 orphan matches against current booking/mutation relations; these remain a historical/schema-review item.

## Settlement

**PASS WITH REVIEW**

The existing QRIS/Mandiri settlement contract remains unchanged. No settlement was created or changed. Production settlement aggregation and bank mutation linkage remain unverified.

## Expense

**PASS WITH REVIEW**

Existing expense lifecycle and accounting behavior remain covered by the current code/tests. No expense record was created or modified.

## Vendor

**PASS WITH REVIEW**

Existing vendor master and linkage behavior remain intact. No vendor data was changed.

## Security

**PASS WITH REVIEW**

- Admin payment metadata editing is protected by admin authorization.
- No secrets, tokens, bootstrap JSON, or database URLs were printed.
- Secret Manager bootstrap passed in the managed API workflow.
- Production audit-role verification passed. A complete route-by-route security review was not completed in this phase.

## Central Finance

**PASS WITH REVIEW**

No Central Finance posting was initiated or manually created. Existing Sport Center isolation and explicitly supported integration boundaries remain unchanged; the production audit found zero rows in `central_finance_processing`.

## Tests, Typecheck, Build

**PASS**

- `pnpm --filter @workspace/scripts run typecheck`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/api-server run test`
  - 17 suites passed
  - 109 tests passed
- `pnpm --filter @workspace/api-server run build`
- `pnpm --filter @workspace/sport-center run build`
- `git diff --check`

## Production Smoke Test

**PASS WITH REVIEW**

Read-only requests to the known production domain returned HTTP 200:

- `/`
- `/health`
- `/api/health`
- `/api/facilities`
- `/api/promos`
- `/api/settings`

The API health response reported `{"status":"ok"}`. No booking, payment, WhatsApp, invoice, reconciliation, or other financial mutation was performed.
- Public content routes returned the existing 301 trailing-slash redirect and were reachable at the redirected URL.

## Production Mutation Proof

**NONE**

Production data mutation during this phase: **NONE**.

- No customer booking created.
- No payment created or confirmed.
- No payment method changed.
- No invoice, tax, settlement, reconciliation, or accounting row changed.
- No WhatsApp message sent.
- No production storage object changed.

## Closure Blockers / Review Items

1. Official deployment metadata must be reconciled with the reachable custom domain; `getDeploymentInfo()` currently reports no active deployment.
2. Historical production anomalies listed in the Database, Accounting, and Reconciliation sections require owner/accounting classification. They must not be mass-cleaned merely to obtain a PASS.
3. The screenshot/browser check recorded one 401 resource response; authenticated admin resource health was not proven by the non-destructive public smoke test.
4. No code change or republish is justified by the current evidence. Any next verification should remain read-only unless the owner explicitly authorizes a canonical write-path test in DEV.
