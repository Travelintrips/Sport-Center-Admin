---
name: Payment metadata-only edits
description: Rules for editing payment method/provider without financial side effects
---

Payment classification changes must be isolated from confirmation and financial posting.

**Why:** A payment method is customer-facing metadata, while provider settlement terms and posted journals are financial facts. Treating one as the other can invent settlement data or corrupt an audit trail.

**How to apply:**
- Classify non-gateway/manual methods as `unknown`, never as a known processor merely to satisfy a non-null field. QRIS uses the owner-approved Mandiri settlement path.
- A confirmed `unknown` payment is a valid manual receipt: project it as paid but unsettled, with no fabricated bank settlement account, settlement date, rule version, or MDR.
- Apply that manual-provider exception in both the projection trigger and the canonical metadata resolver; either can be invoked by a confirmed-payment update.
- Known processors remain fail-closed until one exact owner-approved settlement rule matches the company, account, provider, and effective date.
- Once a mirror is posted, source changes that would alter any projected financial, settlement, or state field are reconciliation/reversal work and must fail with a controlled conflict rather than silently update the journal.
- A trigger that protects payment confirmation is a critical deployment migration: bundle it with the service, verify its dependency and enabled event definition, and finish that work before accepting HTTP traffic.

**Why:** A best-effort or background trigger migration leaves a window where one confirmation entry point can use outdated financial rules.

**How to apply:** Fail startup if the payment mirror migration cannot install and verify the canonical trigger. Do not rely on route-by-route guards or a manually run development script for the live confirmation contract.
