---
name: Paylabs Public Key Verification
description: Sandbox/prod public key handling, fail-closed webhook enforcement, and admin UI security rules.
---

## Rule
- `paylabsPublicKey` in `PaylabsConfig` = Paylabs-owned key (for verifying their webhook signatures).
- `privateKey` in `PaylabsConfig` = merchant private key (for signing our requests to Paylabs).
- Never confuse the two; `normalizePaylabsPublicKey()` in `lib/paylabs.ts` is the canonical normalizer for Paylabs's public keys.

## Fail-Closed Webhook (PHASE 4)
- Webhook handler (`paylabsPayment.ts`) resolves public key order: DB → env var → empty.
- If key is empty and `PAYLABS_MOCK=true` (non-prod): log `SKIPPED_MOCK_MODE`, continue.
- If key is empty and not mock: respond `{ errCode: "CONFIGURATION_ERROR" }`, return. DO NOT process payment.
- If key is present: `normalizedPublicKey = normalizePaylabsPublicKey(cfg.paylabsPublicKey)` then verify. If INVALID: respond `{ errCode: "SIGNATURE_INVALID" }`, return.

## Admin UI Security (PHASE 2)
- GET `/api/admin/paylabs/settings` returns `sandboxPublicKeyConfigured: boolean` and `prodPublicKeyConfigured: boolean` — never returns the actual key.
- PATCH `/api/admin/paylabs/settings`: if client sends non-empty `sandboxPublicKey`, normalize with `normalizePaylabsPublicKey()` then store. Empty string = "don't change existing key".
- Frontend state: no `publicKey` in `sandboxCreds`/`prodCreds`. Instead: `sandboxPaylabsPubKeyConfigured` boolean + `newSandboxPaylabsPubKey` string (cleared after save).
- Export JSON excludes public keys entirely. Import ignores any public keys in imported JSON.

## PEM Normalization
- `normalizePaylabsPublicKey(raw)`: handles literal `\n` (from secret managers), raw base64, and proper PEM. Returns well-formed PEM or `""` if input is blank/malformed.
- `normaliseKey(key, type)` (internal): same but throws on empty body. Updated to preserve original PEM header type.

## Log Fields (webhook signature result)
Only log: `hasPublicKey`, `hasSignature`, `hasTimestamp`, `hasPartnerId`, `verificationResult`, plus auto-added `requestId`/`merchantTradeNo` from `wlog` wrapper.
Never log: public key value, private key, full signature, raw credentials.

**Why:** Spec PHASE PAYLABS-SANDBOX-PUBKEY-04 — webhook was fail-open (SKIPPED_NO_PUBLIC_KEY → continue), which allowed unverified callbacks to confirm payments. Changed to fail-closed to prevent spoofed webhook attacks.
