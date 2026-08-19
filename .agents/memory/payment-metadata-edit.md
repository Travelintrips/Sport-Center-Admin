---
name: Payment metadata-only edits
description: Rules for editing payment method/provider without financial side effects
---

Payment classification changes must be isolated from confirmation and financial posting.

**Why:** A payment method is customer-facing metadata, while provider settlement terms and posted journals are financial facts. Treating one as the other can invent settlement data or corrupt an audit trail.

**How to apply:**
- Classify non-gateway/manual methods as `unknown`, never as a known processor merely to satisfy a non-null field. QRIS uses the owner-approved Mandiri settlement path.
- A confirmed `unknown` payment is a valid manual receipt: project it as paid but unsettled, with no fabricated bank settlement account, settlement date, rule version, or MDR.
- Known processors remain fail-closed until one exact owner-approved settlement rule matches the company, account, provider, and effective date.
- Once a mirror is posted, source changes that would alter any projected financial, settlement, or state field are reconciliation/reversal work and must fail with a controlled conflict rather than silently update the journal.
