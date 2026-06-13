---
name: Bank Reconciliation Audit Lessons
description: Key bugs found and patterns to watch in the bank reconciliation system
---

**Approve must propagate to booking/payment** — `propagateApproval()` in approve endpoint updates `payments.status → confirmed` then `bookings.status → confirmed` (only if still pending_payment/waiting_confirmation). Without this, reconciliation approval had zero effect on the booking lifecycle.

**Why:** Reconciliation was purely a ledger annotation — booking stayed pending_payment even after admin confirmed bank receipt.

**How to apply:** Any future approve-like action on bank mutations must call `propagateApproval(candidateType, candidateId)`.

---

**transactionDate can be null/invalid in DB** — Guard all `new Date(mutation.transactionDate)` with `!isNaN(date.getTime())` before calling `.toISOString()`. Old records may have missing dates.

**Why:** Runtime `RangeError: Invalid time value` crashed matching for old mutations.

---

**statusCounts must be rebuilt explicitly** — Never filter the `conditions[]` array by index to build `baseConditions` for status counts. Index order is fragile. Always build a separate array without the status condition.

**Why:** Fragile index-based filter would silently remove wrong condition after any refactor.

---

**runMatching needs a concurrency lock** — `_matchingInProgress` flag prevents two admins from running matching simultaneously. Without it: duplicate match records, inconsistent mutation statuses.

---

**DELETE approved guard** — Approved mutations must never be deleted (they are the audit trail). Block at API level, not just UI.

---

**Stats bar must use API statusCounts, not client-side reduce** — Computing stats from current page gives wrong totals when paginated. API returns `statusCounts` (group by status, same filters minus status filter).
