# Mandiri QRIS Gmail reconciliation — DEV only

## Source
Mailbox: cahayasejatiteknologi@gmail.com. Read-only Gmail OAuth (least privilege); never store credentials in Git. Merchant notification text is untrusted and must not by itself mark a booking paid.

## Architecture
1. Poll Gmail via read-only scope and a sender allowlist verified from real message headers (not display name). Fetch message ID and MIME text, record an immutable fingerprint; do not modify mailbox.
2. Parse the text with `scripts/qris-mandiri/mandiri-qris-parser.mjs`. Require success status, reference, valid time, and amount+tip=total. Use Asia/Jakarta when converting local transaction timestamps.
3. In a DEV-only transaction, persist message ID, unique (merchant identifier, acquirer, reference), amount in integer cents, timestamp, validation status and sanitized metadata. Never persist customer PAN, merchant PAN or raw email unless separately justified and protected.
4. Reconcile only against an existing unpaid QRIS booking with an authoritative unique mapping to the transaction (e.g. gateway transaction ID, dynamic QR reference, or settlement confirmation). Amount and time alone are insufficient.
5. Ambiguous or unverified cases -> review_required; no payment ledger mutation, membership activation, X904 commands or WhatsApp notification.
6. Once bank/gateway evidence and unique booking match exist, perform an idempotent atomic confirmation using existing booking payment service, then emit WA via existing outbox. Avoid creating a parallel confirmation path.

## Suggested DEV schema (requires review against actual schema before migration)
qris_email_transactions: id, gmail_message_id UNIQUE, merchant_id, acquirer, reference, transaction_at, amount_minor, tip_minor, total_minor, parse_status, match_status, booking_id NULL, created_at, updated_at.
UNIQUE(merchant_id, acquirer, reference) with a conflict queue for inconsistent duplicate messages.
qris_reconciliation_audit: id, email_transaction_id, old_status, new_status, reason_code, actor, created_at.

## Security & rollout gates
- Confirm actual sender identity from headers and validate merchant PAN against an allowlist stored in server configuration (not UI).
- Gmail tokens server-side only, encrypted, no browser access.
- No production changes; no DEV deployment until DB/environment mapping confirmed.
- Regression: existing manual proof upload, paid booking, DP, membership, group booking, WA, X904, duplicates, refunds.
- E2E: Gmail ingest -> parse -> candidate -> manual review or uniquely verified match -> existing confirmation -> audit/WA exactly once.
- Require real DEV database, integration tests, and operational read-back before any PROD proposal.


## Runtime DEV configuration

Required server-side environment variables (never expose these in the browser and never commit values):

- `QRIS_GMAIL_DEV_INGEST_ENABLED=true`
- `QRIS_GMAIL_CLIENT_ID_DEV`
- `QRIS_GMAIL_CLIENT_SECRET_DEV`
- `QRIS_GMAIL_REFRESH_TOKEN_DEV` — OAuth grant must be Gmail read-only.
- `QRIS_GMAIL_MAILBOX_DEV=cahayasejatiteknologi@gmail.com`
- `QRIS_GMAIL_ALLOWED_FROM` — exact sender address from the real Mandiri/YOKKE message header, not the display name.

The source uses Gmail API read operations only. It does not mark messages read, label, archive, delete, send, or modify them.

### Frontend status

Booking detail may expose only a sanitized detection object: review status, transaction timestamp, and confidence. It must not expose payer name, PAN, raw email, Gmail message ID, or full provider reference. The banner text is intentionally **Pembayaran QRIS Terdeteksi / sedang diverifikasi**, never **Lunas**, until the existing canonical payment/reconciliation flow confirms the payment.

### Deployment gate

The Sport Center repository currently has no usable Sport Center DEV hosting target in this workflow. Runtime validation must therefore use an isolated local/VPS DEV process connected to `SUPABASE_DATABASE_URL_DEV`, or a dedicated DEV deployment when available. Do not point a development process at the PROD database.
