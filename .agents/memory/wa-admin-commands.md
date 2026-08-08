---
name: WA Admin Commands & BizPortal
description: Admin WA command flow, security, new booking columns, BizPortal endpoint patterns.
---

## Admin Phone Lookup
`getAdminPhones()` checks `settingsTable.adminWaPhones` FIRST, then env `ADMIN_WA_PHONES`. If DB has a value, env vars are ignored. Test with the DB phone, not env phone.

## Admin Group Recipient Precedence
Admin WhatsApp recipients must use the configured database/environment list as the primary source; `ADMIN_WA_GROUP` is fallback-only when no admin recipient is configured, so the same rekap does not go to two groups.

**Why:** The database admin recipient list and `ADMIN_WA_GROUP` previously merged, causing identical rekap messages to appear in both the intended group and an older group.

**How to apply:** Preserve the primary recipient list and only use `ADMIN_WA_GROUP` when that list is empty. Deduplicate normalized recipients before sending.

## WA Admin Commands (whatsapp.ts handleAdminCommand)
- APPROVE SC-xxxx → waiting_admin_approval → pending_payment + sets approvedByAdminPhone/approvedAt
- REJECT SC-xxxx [reason] → rejected + sets rejectedReason
- STATUS SC-xxxx → sends booking summary to admin
- PAID SC-xxxx → pending_payment/waiting_confirmation/waiting_admin_approval → confirmed + sets paidAt
- CANCEL SC-xxxx [reason] → any non-terminal status → cancelled
- RESEND SC-xxxx → resends appropriate WA based on current status

## Security
- Non-admin sending admin-looking commands → logs `unauthorized_admin_command` + WA reply
- Detection regex: `/^(APPROVE|KONFIRMASI|SETUJU|REJECT|TOLAK|PAID|LUNAS|BAYAR|CANCEL|BATALKAN|RESEND|STATUS)\s+SC-\d+/i`

## New bookings columns (added FASE 3)
- `approved_by_admin_phone` TEXT
- `approved_at` TIMESTAMPTZ
- `rejected_reason` TEXT
- `paid_at` TIMESTAMPTZ

## BizPortal API (waBookingsAdmin.ts)
- GET /api/admin/wa-bookings?status=&search=&page=&limit= — list WA source bookings
- GET /api/admin/wa-bookings/:orderNumber/detail — booking + session + history + auditLogs
- POST /api/admin/wa-bookings/:orderNumber/approve — same as WA APPROVE
- POST /api/admin/wa-bookings/:orderNumber/reject — { reason } body
- POST /api/admin/wa-bookings/:orderNumber/paid — confirms payment + confirmed status
- POST /api/admin/wa-bookings/:orderNumber/resend — resend WA based on status

## Audit actions (FASE 3)
- admin_approved_via_wa (BizPortal web)
- admin_rejected_via_wa (BizPortal web)
- admin_paid_via_wa (WA PAID command or BizPortal)
- payment_link_sent (RESEND)
- booking_cancelled_via_wa (CANCEL command)
- unauthorized_admin_command (non-admin tried admin command)

**Why:** Admin phone from DB takes precedence over env — settings page is the source of truth in production; env vars are fallback only.
