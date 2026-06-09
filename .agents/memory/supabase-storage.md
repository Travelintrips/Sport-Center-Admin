---
name: Supabase Storage for images/uploads
description: Where facility images, payment proofs, and QRIS are stored and why; how the storage project differs from the DB project.
---

# Image / file storage

All uploaded files (facility images, payment proofs, QRIS) are stored in **Supabase Storage**, NOT local disk. Public URLs are stored directly in the DB.

**Why:** App runs on Replit autoscale = ephemeral filesystem. Files written to local disk (`process.cwd()/uploads`) vanish on redeploy/restart, so images 404'd in production.

**How to apply:**
- Storage lives in a **different Supabase project** than the database. DB/anon key project is `xssrfshdrtdfupgqwfdw`; **Storage project is `nzdweipzckfszczzqtuw`**. The `SUPABASE_SERVICE_ROLE_KEY` secret is for the storage project (its JWT `ref` claim = `nzdweipzckfszczzqtuw`); the storage helper derives the project URL from that ref.
- Public buckets: `facility-images` (facility photos + QRIS under `qris/` prefix, 5MB image-only) and `payment-proofs` (proofs, 10MB, any type). Both already existed pre-migration.
- Server helper `artifacts/api-server/src/lib/supabaseStorage.ts` wraps upload/delete/getPublicUrl using `@supabase/supabase-js` + service role key. All upload routes use `multer.memoryStorage()` then `uploadToStorage(...)`.
- Storage is shared across dev & prod environments (same storage project), so one upload serves both DBs — only the per-environment DB URL rows differ.
- Frontend renders stored URLs raw (`images[0].url`, `qrisImageUrl`); proof rendering passes `http...` URLs through unchanged. No frontend URL-prefixing — store absolute Supabase public URLs.

**Known gap:** `POST /payments/proof-upload` and `POST /storage/upload-proof` are intentionally unauthenticated (anonymous customers upload payment proof without an account). Size/mime limits are the only abuse guard. Adding auth would break anonymous booking; rate-limiting is a possible future hardening.
