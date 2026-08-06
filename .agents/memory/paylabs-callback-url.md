---
name: Paylabs callback URL configuration
description: How getPaymentCallbackUrl() resolves the notifyUrl sent to Paylabs, and the production URL for sc.travelintrips.co.id
---

## Priority chain (artifacts/api-server/src/lib/appUrl.ts)

1. `PAYLABS_CALLBACK_BASE_URL` env var — explicit override, wins in all modes
2. Dev mode (NODE_ENV != production): always `REPLIT_DEV_DOMAIN` — DB paymentDomain and APP_URL are intentionally ignored in dev to prevent callbacks going to production
3. Prod mode: DB `settings.paymentDomain` → `APP_URL` env var → `REPLIT_DEV_DOMAIN` fallback

## Production URL

`https://sc.travelintrips.co.id` — set in:
- DB `sport_center.settings.payment_domain` and `app_url`
- Env var `APP_URL` (shared environment)

## Why dev ignores APP_URL

`APP_URL` is set to the production URL (`sc.travelintrips.co.id`). Old code used APP_URL in dev mode too, causing Paylabs to callback to production instead of the dev Replit server — bookings stayed `pending_payment` despite Paylabs dashboard showing "Sukses".

## Root cause of original bug (now fixed)

Paylabs webhook was never received by dev server → zero `POST /api/paylabs/webhook` in API logs → all paylabs_transactions stayed PENDING, bookings stayed pending_payment.

**Why:** `getPaymentCallbackUrl()` used `APP_URL` (prod URL) even in dev mode.

## Additional fixes applied

- `app.ts`: `express.json({ verify: (req, _, buf) => req.rawBody = buf })` — captures raw body bytes before JSON parsing, for correct signature verification
- `paylabsPayment.ts`: webhook handler uses `req.rawBody` if available, falls back to `JSON.stringify(req.body)`
- Diagnostic log emitted on every `create-payment`: `[paylabs] notifyUrl yang dikirim ke Paylabs`

## Signature verification

DB `sandboxPublicKey = ""` (empty string) → verification skipped in sandbox (intentional). `PAYLABS_SANDBOX_PUBLIC_KEY` env var is set but ignored because `??` operator doesn't fall back on empty string.
