---
name: Payment method OCR auto-detection
description: Rules for classifying payment methods from proof OCR and safely applying the result.
---

Payment proof OCR may automatically update `payment_method` only for a distinctive high-confidence rail (QRIS, named bank, EDC debit/credit, or named wallet). Store the detector result in `ocr_data` and write an audit event containing the old method, new method, confidence, and matched signals.

**Why:** OCR text is noisy and a generic bank mention must not silently overwrite a payment method. QRIS also has a canonical `mandiri_direct` provider invariant in the Sport Center accounting flow.

**How to apply:** Keep the detector pure and thresholded at 0.85; run it after payment proof creation and from manual reconciliation rescans. If a confirmed payment is changed, expose that accounting review is required rather than reposting automatically.

Historical Gym payments that lack settlement metadata may be surfaced as
`GYM_QRIS_METADATA_REVIEW` candidates when the bank description signals QRIS,
but they must remain review-only until high-confidence QRIS evidence and
deterministic company/settlement-account enrichment are available. The repair
action may then replay accounting idempotently by payment ID.

**Why:** Legacy rows must not disappear from reconciliation, but a nominal/date
match alone is not enough evidence to relabel a transfer or infer ownership.

**How to apply:** Keep the candidate visible, require OCR or existing verified
QRIS evidence, fail closed when company/account resolution is ambiguous, and
never send a raw external account number to a differently typed public FK.

Existing proofs are reprocessed through an admin-only cursor-based bulk endpoint in batches of at most five. Each proof is isolated so one download/OCR failure does not stop the batch; low-confidence results update OCR metadata but never overwrite the payment method.

**Why:** A full production backfill can be slow and resource-intensive, while a single failed or unreadable proof should not abort the entire recovery run.

**How to apply:** Keep bulk runs sequential and resumable by cursor, show updated/failed/review-required counts in the admin UI, and require an explicit confirmation before starting the run.