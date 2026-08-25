---
name: Paylabs Private Key Persistence Fix
description: Root cause and fix for masked/corrupted private key overwriting DB on every settings save.
---

## Root Cause
GET `/api/admin/paylabs/settings` was returning raw `sandboxPrivateKey` / `prodPrivateKey` values from DB.
Frontend loaded these into state. On save, `handleSaveAll()` **always** sent them back in PATCH body — even when the user only changed another field.
If the DB key was already corrupted/masked, the cycle perpetuated (GET → state → PATCH → DB → repeat).

**Why:** Private keys must be write-only. GET must never return them; PATCH must only accept them when explicitly provided and valid.

## Fix
- `lib/paylabs.ts`: Added `normalizePaylabsPrivateKey(raw)` (normalize whitespace/headers) and `isPrivateKeyValid(raw)` (tries multiple crypto.createPrivateKey formats, rejects mask patterns).
- `routes/paylabsSettings.ts` GET: Returns `sandboxPrivateKeyConfigured: boolean` and `productionPrivateKeyConfigured: boolean` (via `isPrivateKeyValid()`). Never returns raw key. Corrupted/masked keys yield `false`.
- `routes/paylabsSettings.ts` PATCH: `applyPrivateKey()` helper — rejects empty, mask patterns (`/^[•*·]+$/`, "Configured", "[REDACTED]"), normalizes, validates with `crypto.createPrivateKey()`, returns HTTP 422 on failure. Only writes to DB on explicit valid input.
- `PaylabsGateway.tsx`: Removed `sandboxCreds.privateKey`/`prodCreds.privateKey` state. Now uses `sandboxPrivateKeyConfigured` boolean + `isEditingSandboxPrivateKey` flag + `sandboxPrivateKeyInput` (write-only textarea). Textarea only appears after explicit "Set / Ganti" button click. PATCH body only includes private key if editor is open and input is non-empty.
- `BookingDetail.tsx`: Catches RSA/DECODER/signing errors and replaces with safe user message.

## Key API Contract
- GET response shape: `{ sandboxPrivateKeyConfigured: boolean, productionPrivateKeyConfigured: boolean, sandboxPublicKeyConfigured: boolean, prodPublicKeyConfigured: boolean, sandboxMerchantId, prodMerchantId, storeId, ... }`
- PATCH: Send `sandboxPrivateKey` only when user explicitly entered a new key. Omitting the field = keep existing key.

## How to Apply
- If user reports "private key keeps getting cleared": check that frontend is not populating editor state from API response.
- If isPrivateKeyValid returns false unexpectedly: check `normalizePaylabsPrivateKey()` — raw base64 defaults to PKCS#8 wrap.
- After this fix, if DB has a corrupted key, `sandboxPrivateKeyConfigured` = false → user must re-enter the real key via admin UI.
