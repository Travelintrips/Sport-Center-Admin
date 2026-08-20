---
name: Payment proof OCR validation
description: Server-side OCR rules for checking uploaded payment proof against the selected payment method.
---

Uploaded image proofs are scanned server-side with Tesseract before a payment is created. The scan is signed by the server and stored in the existing OCR JSON field; the browser cannot override the scan result.

**Why:** Payment method labels can be wrong or manually edited, and accounting/reconciliation must not silently accept a QRIS proof as a bank transfer or vice versa.

**How to apply:** Treat explicit QRIS text as QRIS, bank/transfer evidence as Transfer Bank, and unreadable/unsupported proofs as unknown for manual review. Block submission, admin method edits, and WhatsApp approval only when OCR has a confident contradictory result; do not auto-confirm based on OCR alone. Generic success words such as “berhasil” or “sukses” are not transfer evidence because they appear on QRIS receipts too.