---
name: Payment metadata-only edits
description: Rules for editing payment method/provider without financial side effects
---

Payment classification changes must be isolated from confirmation and financial posting.

**Why:** A payment method is customer-facing metadata, while provider settlement terms and posted journals are financial facts. Treating one as the other can invent settlement data or corrupt an audit trail.

**How to apply:**
- Classify non-gateway/manual methods as `unknown`, never as a known processor merely to satisfy a non-null field. QRIS uses the owner-approved Mandiri settlement path.
- A confirmed `unknown` payment is a valid manual receipt: project it as paid but unsettled, with no fabricated bank settlement account, settlement date, rule version, or MDR.
- When a confirmed legacy/manual receipt is corrected to QRIS, derive the Mandiri CST receiving account server-side from the active owner-approved rule in the same transaction. Never reuse a legacy account value or accept an account from the browser.
- Apply that manual-provider exception in both the projection trigger and the canonical metadata resolver; either can be invoked by a confirmed-payment update.
- Known processors remain fail-closed until one exact owner-approved settlement rule matches the company, account, provider, and effective date.

**Why:** Historical manual rows can retain a placeholder or obsolete receiving
account even when the company's Mandiri CST configuration is correct. Reusing
that value falsely rejects a legitimate QRIS correction; letting the client
choose an account would weaken the settlement control.

**How to apply:** Treat the server-derived QRIS account as a routing prerequisite
for the metadata change, not a caller-controlled settlement edit. Keep all other
financial values, lifecycle fields, and journal lines immutable.

## Historical Mandiri rule resolution

For Mandiri Direct QRIS, legacy owner-approved rules may not have a stored
`rule_version`. Accept the effective historical rule and record a stable
legacy-derived version identifier for auditability.

**Why:** The settlement UI created earlier Mandiri rules without versions; a
hardcoded current version made valid historical QRIS corrections impossible.

**How to apply:** When same-account historical rules overlap, the latest
effective start may win only when every matching rule has the same settlement
delay. Different delays remain an ambiguous financial configuration and must
fail closed. This exception is for Mandiri legacy configurations, not Paylabs.
- Once a mirror is posted, source changes that would alter any projected financial, settlement, or state field are reconciliation/reversal work and must fail with a controlled conflict rather than silently update the journal.
- A trigger that protects payment confirmation is a critical deployment migration: bundle it with the service, verify its dependency and enabled event definition, and finish that work before accepting HTTP traffic.

**Why:** A best-effort or background trigger migration leaves a window where one confirmation entry point can use outdated financial rules.

**How to apply:** Fail startup if the payment mirror migration cannot install and verify the canonical trigger. Do not rely on route-by-route guards or a manually run development script for the live confirmation contract.

## Journal metadata synchronization

Every permitted payment-method/provider correction must propagate atomically from
the canonical Sport Center payment to its internal accounting journal, public
payment mirror, and linked public accounting entry. The propagation is
metadata-only; it must never alter amounts, tax, lines, dates, settlement facts,
or posting state.

**Why:** Updating only the operational payment creates contradictory accounting
evidence and makes audit/reconciliation reports unreliable.

**How to apply:** Treat all journal-sync triggers as startup-critical
dependencies. If a linked journal/entry cannot be synchronized, fail the
payment update so the database rolls back the entire transaction.

## Production provisioning order

Provision new payment-accounting functions and triggers in production before
releasing an API version that verifies them during startup.

**Why:** The API correctly fails closed before opening its HTTP port when a
required financial trigger is absent; Autoscale then rejects the release on its
readiness check even though the source build succeeded.

**How to apply:** Use the narrowly scoped, transactional production trigger
migration, verify every required trigger after applying it, then publish the API
release.
