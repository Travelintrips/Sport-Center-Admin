# PIN 700 application-pipeline verification — 10 November 2026

## Boundary
This change fixes runtime PIN approval and paid-access recovery. It does not cancel historical bookings, create PROD bookings/payments, verify bank receipts, or send commands to X904. Existing member and VIS runtime entrypoints are not changed.

## Reproduced failures on base c1531a28
The initial full application pipeline had **1 passed / 5 failed** assertions. Failures reproduced missing mandatory-audit rollback, acceptance of disabled/demoted staff tokens (two assertions), non-idempotent approval retry, and interference from legacy cleanup during paid-grant ACK recovery.

## Runtime corrections
- PIN approval now uses current-account authentication and revalidates the actor under transaction lock.
- Payment, booking, held access, and mandatory audit are checked/written within the guarded approval transaction. Audit failure rolls the authorization back.
- Missing proof/confirmation timestamp and insufficient or rejected payment cannot authorize access.
- Retry and concurrent approvals return the persisted authorization with exactly one matching audit.
- Paid access awaiting recovery stays under the paid-access worker, not legacy cleanup.
- Both ACTIVATE and SUSPEND ACKs must match the intended UID and target group.

## Observed verification
- Original six-assertion pipeline after fixes: **6/6 passed**.
- Expanded real HTTP + PostgreSQL pipeline: **14/14 passed**. Covers application-role RLS, real name and payment configuration resolution, payment HTTP confirmation, actual payment-to-grant trigger, staff approval, concurrent retry, stale snapshots, wrong activation/suspend UID, 12-hour expiry and 23:00 WIB cutoff.
- Existing nonmember/VIS worker integration: **26/26 passed**.
- Three pre-existing fixture assertions expected a 30-minute default-enrollment deadline; runtime already uses 3 minutes. The assertions were corrected to the existing 3-minute contract. No default-enrollment runtime code or operational timeout was changed.
- Initial TypeScript and source-contract checks passed before the additional assertions; CI must verify the final published commit again.

## Evidence and limitations
The machine-readable results and raw-result hashes are in `docs/evidence/pin700-application-tests-20261110.json`. Tests use network-isolated disposable PostgreSQL containers; the application pipeline connects as `sport_center_app`, without superuser or BYPASSRLS. Schema setup and failure injection use a separate local fixture account.

Unmocked: checkout HTTP route, identity lookup, payment enrichment, payment confirmation HTTP route, payment-to-access trigger, RLS policies, staff authorization/audit, and access worker. Mocked: OCR, blob transport, external notifications/invoices, accounting startup/projection; device ACKs and snapshots are simulated. This is **not full production or physical-door PASS**.

## Release gate
Require green CI for the exact head commit before merge. Verify the deployed source commit separately. Then assess live upload/read-back and current worker configuration before a controlled transaction; physical door acceptance and rejection require observed on-site evidence. Do not infer live-bank receipt, storage success or door movement from these test results.
