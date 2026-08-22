# Sport Center — Production Remediation Plan

## Scope and safety boundary

This phase audits the application and classifies what can be prevented in
current code. It does **not** mutate production transaction data. No
production booking, payment, invoice, settlement, reconciliation, outbox, or
accounting record was inserted, updated, deleted, backfilled, retried, or
approved.

The supplied production baseline remains the source of truth for historical
counts:

- 376 completed bookings without check-in
- 8 completed bookings without `completed_at`
- 2 future completed bookings (booking 380 and 511)
- 16 duplicate payment groups / 32 payment rows
- 70 confirmed/completed bookings without confirmed payment
- 323 posted, 27 processing, and 12 failed outbox rows
- 68 reconciliation candidate rows

Historical classifications that require record-level production evidence remain
`REVIEW`; this document intentionally does not invent a financial conclusion
from aggregate counts.

## Code root-cause findings

### Booking completion

**Finding:** Current booking completion is centralized in
`lib/bookingLifecycle.completeBooking()`. Scheduler, admin status changes, and
WhatsApp finish all call this service. The service requires:

- prior status `confirmed`
- non-terminal booking
- `checkedInAt`
- session end time reached
- no pending reschedule
- atomic status update guarded by the prior status
- `completedAt` and booking history written together

The other `status = "completed"` writes found in the repository update a
WhatsApp conversation session, not a booking.

**Historical root cause classification:** The 376 missing-check-in and 8
missing-`completed_at` records are consistent with legacy/direct booking status
writes predating the lifecycle guard. The exact writer for bookings 380 and 511
requires the supplied production history/audit evidence and remains
`REVIEW`; historical status is not changed.

**Current prevention:** Complete. Current completion callers use the guarded
lifecycle service, and regression coverage verifies time and check-in
preconditions.

### Payment confirmation and booking transitions

**Finding:** Payment confirmation in the generic admin payment route and two
WhatsApp review paths could confirm a payment while the linked booking was
already outside an active payment state. Group propagation could also write
`confirmed` to a sibling without checking that sibling's status.

**Remediation:** Payment-driven booking confirmation now accepts only:
`pending_payment`, `waiting_confirmation`, `waiting_admin_approval`, or
`paid`. Terminal/confirmed/completed bookings are rejected, and group
propagation skips non-confirmable siblings. Paylabs already had a terminal
booking manual-review guard; the existing guard remains unchanged.

### Payment duplicates

**Current prevention:** Payment-level accounting idempotency is keyed by
payment identity, and the outbox has a unique `(payment_id, event_type)`
constraint. DP and pelunasan remain separate payment types. No historical
duplicate was deleted or merged.

**Historical classification:** The 16 groups require record-level comparison
of payment type, amount, provider identifiers, timestamps, and accounting
links. Keep each group `REVIEW` until that evidence is exported and classified
as `EXACT_TECHNICAL_DUPLICATE`, `LEGITIMATE_MULTIPLE_PAYMENT`,
`DP_PLUS_FINAL`, `RETRY_ATTEMPT`, or `UNKNOWN`.

### Outbox and accounting

The current worker claims with `FOR UPDATE SKIP LOCKED`, uses stale-lock
recovery, preserves payment identity, checks existing journal/public-entry
evidence before marking posted, and applies bounded retry backoff. Central
Finance remains the sole owner when central mode is enabled; no second worker
or journal path was introduced.

The 27 processing and 12 failed records remain `REVIEW` until each row is
classified using payment, correlation, journal, GL, tax, and public-entry
evidence. This phase does not retry them.

### Reconciliation

Runtime reconciliation routes and approval writes use
`sport_center.bank_reconciliation_matches`. The codebase also contains
legacy/public reconciliation structures, so the 68 candidates must remain
unapproved until a schema-level production comparison confirms the canonical
table and `candidate_source` identity model.

**Required follow-up:** add/verify the `candidate_source` schema field in
development only if the live runtime contract requires it, then add a
collision regression test before any production schema operation.

### Event, recurring, and reschedule flows

The existing booking creation, recurring creation, reschedule approval,
blocked-schedule checks, and lifecycle service are the applicable runtime
owners. Reschedule approval clears check-in/completion timestamps and
revalidates conflicts inside a transaction. No historical amount or booking
was changed in this phase.

Event discount and recurring record-level verification remain
`REVIEW` until the previously supplied production audit rows are attached to
the classification report. Any code change must preserve the shared booking
payment and lifecycle contract.

## Verification

- Typecheck: PASS
- API development workflow: PASS (Secret Manager bootstrap and server on port
  8080)
- Booking lifecycle regression tests: added
- Production historical mutation: NONE
- Central Finance unauthorized change: NONE

## Final verdict

- CODE ROOT CAUSES: COMPLETE for current repository writers
- CODE HARDENING: COMPLETE for confirmed payment-transition bypass
- BOOKING LIFECYCLE: ROOT CAUSE IDENTIFIED; current path guarded
- PAYMENT DUPLICATES: historical classification REVIEW
- PAYMENT MISSING: historical classification REVIEW
- OUTBOX: current worker hardened/idempotent; historical rows REVIEW
- RECONCILIATION: runtime table identified, `candidate_source` schema identity REVIEW
- EVENT: historical verification REVIEW
- RECURRING: historical verification REVIEW
- RESCHEDULE: current transactional guard VERIFIED
- CROSS-ENTITY: current contract REVIEW for historical corporate exceptions
- Production historical mutation: NONE
- Central Finance: NO UNAUTHORIZED CHANGE