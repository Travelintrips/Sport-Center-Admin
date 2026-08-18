---
name: Payment method OCR auto-detection
description: Rules for classifying payment methods from proof OCR and safely applying the result.
---

Payment proof OCR may automatically update `payment_method` only for a distinctive high-confidence rail (QRIS, named bank, EDC debit/credit, or named wallet). Store the detector result in `ocr_data` and write an audit event containing the old method, new method, confidence, and matched signals.

**Why:** OCR text is noisy and a generic bank mention must not silently overwrite a payment method. QRIS also has a canonical `mandiri_direct` provider invariant in the Sport Center accounting flow.

**How to apply:** Keep the detector pure and thresholded at 0.85; run it after payment proof creation and from manual reconciliation rescans. If a confirmed payment is changed, expose that accounting review is required rather than reposting automatically.