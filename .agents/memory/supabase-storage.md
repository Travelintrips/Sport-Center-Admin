---
name: Supabase Storage for images/uploads
description: Where facility images, payment proofs, and QRIS are stored and why; how the storage project differs from the DB project.
---

# Image / file storage

Production uploaded files (facility images, payment proofs, QRIS) are stored in **Supabase Storage**, NOT local disk. In Replit development, Replit Object Storage is the primary adapter when available; Supabase DEV storage is the isolated fallback. Public URLs are stored directly in the DB.

**Why:** App runs on Replit autoscale = ephemeral filesystem. Files written to local disk (`process.cwd()/uploads`) vanish on redeploy/restart, so images 404'd in production.

**How to apply:**
- Derive the active Storage project from the environment-specific service-role key; never hardcode a historical Supabase project ref.
- Required runtime buckets are `facility-images` and `payment-proofs`. Production startup ensures these exist; historical URLs can still reference deleted buckets and cannot restore missing bytes.
- Server helper `artifacts/api-server/src/lib/supabaseStorage.ts` wraps upload/delete/getPublicUrl using `@supabase/supabase-js` + service role key. All upload routes use `multer.memoryStorage()` then `uploadToStorage(...)`.
- Development and production Storage credentials are isolated; never assume an object uploaded in one environment exists in the other.
- Frontend renders stored URLs raw (`images[0].url`, `qrisImageUrl`); proof rendering passes `http...` URLs through unchanged. No frontend URL-prefixing — store absolute Supabase public URLs.
- Admin membership proof previews use authenticated API download routes backed by the Storage service role; do not rely on direct public bucket access for financial evidence.
- DEV may start without `SUPABASE_SERVICE_ROLE_KEY_DEV` when Replit Object Storage is available; never enable `ALLOW_DEV_ON_PROD_STORAGE` as a workaround.

**Known gap:** `POST /payments/proof-upload` and `POST /storage/upload-proof` are intentionally unauthenticated (anonymous customers upload payment proof without an account). Size/mime limits are the only abuse guard. Adding auth would break anonymous booking; rate-limiting is a possible future hardening.
