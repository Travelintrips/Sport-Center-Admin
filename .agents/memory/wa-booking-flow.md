---
name: WhatsApp Booking Flow
description: Architecture and gotchas for the full WA booking flow via Fonnte.
---

## Overview
Full WhatsApp-driven booking: customer sends WA → webhook detects intent → sends mini form link → customer fills form → admin gets approve/reject links → staff gets checkin/finish links.

## Key Files
- `artifacts/api-server/src/routes/whatsapp.ts` — all `/api/wa/*` endpoints
- `artifacts/api-server/src/lib/waTokens.ts` — token CRUD (createWaToken, verifyWaToken, consumeWaToken, getWaTokenRow)
- `artifacts/api-server/src/lib/notifications.ts` — WA-specific notifs (notifyWaBookingCreated, notifyWaProofUploaded, etc.)
- `artifacts/sport-center/src/pages/wa/` — 4 standalone pages (BookingForm, BookingStatus, ProofUpload, AdminAction)

## DB Changes Applied
- `sport_center.bookings` — added `source TEXT DEFAULT 'web'` column
- `sport_center.wa_action_tokens` — new table: id, token, booking_id, action, used_at, expires_at, created_at

## Token System
- `createWaToken(bookingId, action, expiryDays)` — generates 64-char hex token
- Actions: `approve_payment | reject_payment | checkin | finish | upload_proof`
- `upload_proof` tokens are REUSABLE (not consumed on use, just expiry-based)
- All other action tokens are SINGLE-USE (consumed via consumeWaToken)

## Frontend Routes (App.tsx)
WA routes must be placed BEFORE the `<Route path="*">` customer catch-all and WITHOUT CustomerLayout wrapper:
```tsx
<Route path="/wa/booking/:facilityId" component={WaBookingForm} />
<Route path="/wa/status/:orderNumber" component={WaBookingStatus} />
<Route path="/wa/proof/:token" component={WaProofUpload} />
<Route path="/wa/action/:token" component={WaAdminAction} />
```

## Webhook Intent Detection
- Booking intent keywords: "booking", "pesan", "mau book", "mau pesen", "sewa", "daftar", "reserv"
- Status check keywords: "status", "cek", "check", "order", "booking saya", "pesanan"
- Facility keywords: basket, futsal, badminton, tennis, gym, voli, renang, squash, golf
- Non-intent messages are silently ignored (no reply sent)

## Scheduler
- Day-of reminder sent at 07:00-08:00 WIB (UTC hour 0); uses in-memory Set to avoid duplicates
- Only WA-sourced (`source = 'whatsapp'`) bookings get staff checkin/finish links on day-of

**Why:** API server build from old compiled bundle won't pick up route changes — always restart `artifacts/api-server: API Server` workflow after whatsapp.ts changes (not just `Start application`).
