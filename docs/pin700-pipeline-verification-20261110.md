# PIN 700 payment/access pipeline — verification record

Scope: anonymous Gym booking, pending proof, canonical payment HTTP confirmation, PIN identity approval, the paid-access worker, simulated activation ACK and scheduled suspension. Historical bookings and all PROD business data remain unchanged.

## Baseline defects reproduced

Baseline source: `c1531a28fafac84e013a73610a8d5fb5194104b7`.
The isolated PostgreSQL/HTTP suite reported 1 passed and 5 failed (6 total). Recorded at `/opt/sc-pin700-pipeline-red.json` on srv1792369.

- Approval returned HTTP 200 when its mandatory audit insert failed.
- Disabled operator token was accepted (HTTP 200 rather than 401).
- Demoted operator token was accepted (HTTP 200 rather than 401).
- Approval retry returned 409 rather than the already committed outcome.
- Recovery after an invalid activation ACK permitted legacy cleanup to compete with the paid-grant flow; the scoped suspend lifecycle did not finish.

## Runtime corrections in this branch

`bookings.ts`: current-account authentication, an in-transaction account recheck, serialized approval, payment-before-grant lock order, confirmed payment/proof/amount checks, mandatory audit in the same transaction as grant verification, and an idempotent response bound to the saved grant/payment audit.

`x904NonmemberDailyAccessWorker.ts`: a paid grant in review retains ownership of its cleanup instead of competing with legacy nonmember cleanup; both activation and suspension ACKs must identify the intended UID and group.

No changes to membership checkout, general payment confirmation, bank-verification policy, production configuration, device executors or business records are included.

## Verification completed after corrections

- Workspace libraries and API TypeScript checks: passed.
- Diff whitespace check: passed.
- Source-contract suites `x904NoLoginPinReviewSafety` and `x904PublicPinInputContract`: 13/13 passed.
- Read-only PROD catalog audit: application role is neither superuser nor BYPASSRLS; required SELECT/UPDATE/INSERT grants and the existing users RLS policy are present for the newly used locks. No privileges or policies were changed.

## Verification NOT completed

The post-fix PostgreSQL pipeline run has not produced a result. A previous fixture reset stopped on role dependencies. A fresh network-isolated database test invocation was submitted for Desktop Commander review; it has not been reported as executed at this checkpoint. This is NOT an integration PASS and must not be merged/deployed as verified on these results alone.

The dedicated CI job is prepared but has not been published or executed for this fix. Previous green jobs for PRs #728 and #735 are not evidence for these new runtime changes.

## Test boundary

The application uses its real HTTP routes, identity lookup, enrichment, payment-to-grant trigger, RLS policies, audit path and worker, connected as sport_center_app rather than the provisioning superuser. External OCR, blob storage, message transport, financial accounting projection/startup, device ACKs and snapshots remain controlled test doubles. Test clock and device messages are synthetic. These tests do not prove live bank receipt, Supabase Storage operation, VMSC execution, door movement, or field auto-suspension.

No physical E2E PASS may be inferred from compilation, contract tests, this record or simulated device messages.
