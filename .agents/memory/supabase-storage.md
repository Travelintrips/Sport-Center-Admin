---
name: Supabase Storage for images/uploads
description: Where facility images, payment proofs, and QRIS are stored and why; how the storage project differs from the DB project.
---

# Image / file storage

All uploaded files (facility images, payment proofs, QRIS) are stored in **Supabase Storage**, NOT local disk. Public URLs are stored directly in the DB.

**Why:** App runs on Replit autoscale = ephemeral filesystem. Files written to local disk (`process.cwd()/uploads`) vanish on redeploy/restart, so images 404'd in production.

**How to apply:**
- Storage and DB live in the **same Supabase project** `xssrfshdrtdfupgqwfdw`. The `SUPABASE_SERVICE_ROLE_KEY` JWT `ref` claim = `xssrfshdrtdfupgqwfdw`; storage helper derives URL from that ref automatically.
- Public buckets: `facility-images` (facility photos + QRIS under `qris/` prefix, 5MB image-only) and `payment-proofs` (proofs, 10MB, image-only). Both created/confirmed on 2026-06-11.
- Server helper `artifacts/api-server/src/lib/supabaseStorage.ts` wraps upload/delete/getPublicUrl using `@supabase/supabase-js` + service role key. All upload routes use `multer.memoryStorage()` then `uploadToStorage(...)`.
- Storage is shared across dev & prod environments (same storage project), so one upload serves both DBs — only the per-environment DB URL rows differ.
- Frontend renders stored URLs raw (`images[0].url`, `qrisImageUrl`); proof rendering passes `http...` URLs through unchanged. No frontend URL-prefixing — store absolute Supabase public URLs.

**Known gap:** `POST /payments/proof-upload` and `POST /storage/upload-proof` are intentionally unauthenticated (anonymous customers upload payment proof without an account). Size/mime limits are the only abuse guard. Adding auth would break anonymous booking; rate-limiting is a possible future hardening.
