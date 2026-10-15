# Gym-X904 Deployment and Rollback Guide

STATUS: PRE-RELEASE. Typecheck PASS; E2E TypeScript NOT verified. No production activation yet.

## Scope and prerequisites
- Scope strictly to X904; never edit app.ts, stash, or unrelated services.
- Require isolated CST-DEV E2E: exactly 1 ledger success, check-in, booking Rp0, history; replay returns already_processed; concurrent requests 150ms and rollback tested.
- Require Node 22-compatible build, CI, backup, signed-off release and verification that event ingress calls processor. Merely committing the service does NOT enable processing.

## Production migration sequence
1. Keep X904 ingestion/processing disabled, verify production DB identity and a tested backup.
2. Verify existing raw_events event_id primary key and mapping FK to sport_memberships plus partial verified unique index.
3. Only after DEV E2E PASS, review and apply the ledger schema from docs/sql/gym-x904-processed-events-dev.sql as a separately approved production migration; verify table, FK, privileges, index, counts.
4. Deploy API with X904 feature off and inspect health and logs.

## Safe one-member activation
1. Choose a real eligible member with consent and verified machine PIN and device serial. Seno is only an example; do not blindly change a production mapping.
2. Leave all other X904 mappings review_required. Check member/day already has no check-in.
3. Change only the approved pilot mapping to verified; trigger one genuine event; inspect exactly one ledger, check-in, zero-price booking and history.
4. Replay the same event ID, verify already_processed and no duplicate. Verify no unwanted WA, BizPortal or billing side effects.
5. If anomalous, immediately return pilot mapping to review_required and disable processor.

## Emergency rollback
1. Disable X904 ingestion/worker and return pilot mapping to review_required; keep audit data intact.
2. Redeploy the previous known-good artifact using normal release tooling. Use git revert <X904_RELEASE_COMMIT> on a dedicated rollback branch followed by CI; do not use force push or reset a shared branch.
3. Preserve ledger, historical bookings, payments and unrelated database schema; reconcile any unexpected generated rows via audited correction, not blind deletes.
4. Verify previous app health, no duplicates, rollback evidence and incident logs.

Do not merge or deploy to production until the full isolated E2E and recovery tests pass.