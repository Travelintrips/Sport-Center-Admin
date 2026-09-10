# Corporate / Event / Reschedule Implementation Report

Date: 2026-08-23

## Implemented

- Added the admin Event workspace at `/admin/events`.
- Added event creation fields for facility, date/time, participant/PIC, contact information, payer type, company, notes, and the existing 21.4% Event discount.
- Added event list and detail views.
- Added event check-in action using the shared booking lifecycle endpoint.
- Added event usage-photo upload using the existing Supabase Storage-backed `usage_proofs` path.
- Added proof status retrieval for event details.
- Added completion action that relies on the backend completion guard.
- Added a deterministic facility/date/time conflict guard to the existing Event create route.
- Added company payer validation to the existing Event create route.
- Added admin navigation and route registration for Events.

## Files Changed

- `artifacts/sport-center/src/pages/admin/Events.tsx`
- `artifacts/sport-center/src/App.tsx`
- `artifacts/sport-center/src/components/layout/AdminLayout.tsx`
- `artifacts/api-server/src/routes/corporateSubscriptions.ts`

## API

Existing canonical routes reused:

- `POST /events`
- `GET /events`
- `POST /bookings/:id/check-in`
- `POST /bookings/:id/usage-proof`
- `PATCH /bookings/:id/status` with `status=completed`
- `GET /bookings/:id/history`

Added:

- `GET /bookings/:id/usage-proof`

The new Event create guard rejects an active booking occupying the same facility/date/time and validates a company payer against an actual company account. No duplicate event architecture was introduced.

## Frontend

The new admin screen displays:

- Event schedule and participant details;
- booking status;
- payment/billing mode;
- check-in status;
- usage-proof status;
- booking history;
- check-in, proof upload, and completion controls.

Completion remains backend-authoritative. The UI disables completion before check-in, while the backend also requires check-in, event proof, an eligible session, no terminal status, and no pending reschedule.

## Database and Migrations

- No new schema was required for the Event UI or proof status endpoint.
- Existing `corporate_subscriptions`, `corporate_occurrences`, and `usage_proofs` tables are reused.
- Development startup migration completed successfully in the managed API workflow.
- No Production migration was executed. The required Production read-only schema gate and migration approval were not available, and no additive schema change was necessary for this implementation.

## Business Rules

- Event remains a one-time booking variant (`booking_type=event`).
- Corporate Event uses `payer_type=company` and `billing_status=unbilled`.
- Personal Event uses direct-payment semantics already defined by the booking system.
- Event proof is stored as a Storage reference plus metadata, never as a database base64 blob.
- Reschedule continues to use the existing `reschedule_requests` flow and same booking identity. The system does not invent a replacement-occurrence table or silently rewrite finalized invoices.
- Finalized/paid invoice correction remains fail-closed rather than changing historical financial meaning.

## Reschedule

The existing approval transaction locks the facility, rechecks competing bookings and blocked schedules, updates the active booking schedule, clears check-in/completion timestamps, and records booking history. This is compatible with the current ordinary-booking occurrence model.

A separate immutable replacement-occurrence model was not introduced because it would require a schema and billing decision beyond the current canonical contract. The original schedule remains preserved in booking history/audit evidence.

## Tests

- API test suites: **18 passed**
- API tests: **116 passed**
- Sport Center typecheck: **PASS**
- Scripts typecheck: **PASS**
- API typecheck: **PASS**
- API build: **PASS**
- Sport Center build/prerender: **PASS**
- `git diff --check`: **PASS**

## Development Verification

- Secret Manager bootstrap: **PASS**
- Development database: isolated `SUPABASE_DATABASE_URL_DEV`
- Development startup migrations: **PASS**
- API workflow: **RUNNING**
- Web workflow: **RUNNING**
- Protected Event/subscription/proof routes return `401` without credentials.
- No financial test transaction was created.

## Production Verification

The known production domain responded successfully to the previously established read-only smoke endpoints. No Event, booking, payment, invoice, reconciliation, or WhatsApp mutation was performed against Production.

The official deployment metadata and required Supabase Production auditor handshake remain separate closure gates and are not fabricated here.

## Accounting Safety

- No payment was created by Event UI implementation.
- No invoice, tax transaction, journal, journal line, settlement, or reconciliation row was inserted.
- Corporate billing continues through the existing invoice flow.
- Reschedule does not post accounting directly or create a duplicate payment/journal.

## Central Finance Safety

Central Finance architecture and workers were not changed. No Central Finance posting or backfill was executed.

## Production Mutation

**NONE**

## Final Status

```text
Corporate Subscription       = PASS
Weekly Occurrence            = PASS
Stop Subscription            = PASS
Event                        = PASS
Check-in                     = PASS
Usage Proof                  = PASS
Corporate Reschedule         = PASS WITH REVIEW
Event Reschedule             = PASS WITH REVIEW
Conflict Safety              = PASS
Invoice after Reschedule     = PASS WITH REVIEW
Accounting                   = PASS WITH REVIEW
Central Finance              = UNCHANGED
Production                   = BLOCKED
```

Production is blocked only for the separately required deployment metadata reconciliation and read-only Supabase Production audit. The implementation itself is verified in the isolated development environment.