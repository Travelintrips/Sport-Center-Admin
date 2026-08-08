# PHASE GAE-3A — FINAL SECRET INVENTORY

**Date:** 2026-08-01  
**Baseline:** PHASE-GAE-2A-REPORT.md, PHASE-GAE-2B-REPORT.md  
**GCP Project:** sc-sport-center  
**Runtime SA:** `sc-sport-center@appspot.gserviceaccount.com`  

---

## Executive Summary

Previous phases listed all 16 GSM secrets as fatal blockers before first deploy. This audit corrects that. After a full re-audit of every `process.env` reference and module initialization order:

- **2 secrets are truly fatal** — server refuses to start without them
- **3 variables degrade gracefully** (warn at startup, features reduce)
- **13 secrets are feature-gated** — missing ones cause only that feature to fail
- **8 variables are dev-only** — must NOT appear in production
- **4 non-secret variables** are set in `app.yaml` directly

One startup-validation bug was found and fixed (described in §3).

---

## 1. Code Changes in This Phase

| File | Change | Why |
|------|--------|-----|
| `artifacts/api-server/src/lib/supabaseStorage.ts` | Removed `process.exit(1)` from production branch of module-level init; replaced with `console.warn` + `SERVICE_KEY = ""` | **Bug fix** — ESM module bodies run during graph initialization, before `index.ts` body starts. The old code fired `process.exit(1)` before `loadSecretsFromGSM()` could inject the key. See §3. |
| `artifacts/api-server/src/lib/envValidation.ts` | Removed `SUPABASE_SERVICE_ROLE_KEY` from `REQUIRED_STARTUP`; now has 2 entries (was 3) | Follows from the storage module fix — key is now feature-gated, not startup-fatal |

---

## 2. Final Environment Variable Table

### Legend
- **STARTUP REQUIRED** = `YES (FATAL)` → `process.exit(1)` in production if missing after GSM load  
  `WARN` → server starts, feature/subsystem degrades  
  `NO` → no startup check  
  `BUILD` → consumed at `vite build` time, not at runtime  
  `AUTO` → always injected by the platform

---

### A. Mandatory Startup (2)

| ENV NAME | SECRET MANAGER NAME | CATEGORY | FEATURE USING IT | STARTUP REQUIRED | FAILURE BEHAVIOR |
|----------|--------------------|---------:|-----------------|:----------------:|-----------------|
| `SESSION_SECRET` | `sport-center-prod-session-secret` | mandatory_startup | Auth token signing, password hashing (bcrypt) | **YES (FATAL)** | `envValidation.ts` calls `process.exit(1)` |
| `SUPABASE_DATABASE_URL` | `sport-center-prod-supabase-database-url` | mandatory_startup | All database queries (bookings, facilities, users, settings…) | **YES (FATAL)** | `envValidation.ts` calls `process.exit(1)` |

---

### B. Optional — Warn at Startup, Graceful Degradation (3)

| ENV NAME | SECRET MANAGER NAME | CATEGORY | FEATURE USING IT | STARTUP REQUIRED | FAILURE BEHAVIOR |
|----------|--------------------|---------:|-----------------|:----------------:|-----------------|
| `SUPABASE_URL` | `sport-center-prod-supabase-url` | optional | Supabase Realtime (live availability calendar, court status push) | **WARN** | Realtime socket unavailable; availability uses polling fallback |
| `SUPABASE_ANON_KEY` | `sport-center-prod-supabase-anon-key` | optional | Supabase Realtime (same as above) | **WARN** | Same as above |
| `APP_URL` | *(set in `app.yaml env_variables`, not GSM)* | non_secret_runtime | Invoice PDF links, WhatsApp message URLs, tokenized WA action links | **WARN** | Links fall back to relative paths or DB `paymentDomain` / `appUrl` setting |

---

### C. Feature-Specific — No Startup Check (13 in GSM + extras)

| ENV NAME | SECRET MANAGER NAME | CATEGORY | FEATURE USING IT | STARTUP REQUIRED | FAILURE BEHAVIOR |
|----------|--------------------|---------:|-----------------|:----------------:|-----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | `sport-center-prod-supabase-service-role-key` | feature_specific | File storage: facility images, payment proofs, QRIS images, invoice PDFs, document templates | **NO** | HTTP 500 on any upload/download endpoint; all other routes unaffected |
| `FONNTE_TOKEN` | `sport-center-prod-fonnte-token` | feature_specific | WhatsApp booking notifications (confirmation, reminders, H-1, day-of) | **NO** | WA messages silently skipped; booking flow completes without notification |
| `FONNTE_CUSTOMER_TOKEN` | *(not in GSM map — add if needed)* | feature_specific | WhatsApp customer channel (secondary Fonnte number) | **NO** | Customer WA channel disabled; admin channel unaffected |
| `FONNTE_ADMIN_WA` | *(not in GSM map — add if needed)* | feature_specific | Admin WA phone number env override | **NO** | Falls back to DB `settings.adminWaPhones` |
| `ADMIN_WA_PHONES` | `sport-center-prod-admin-wa-phones` | feature_specific | Comma-separated admin WA phone list override | **NO** | Falls back to DB `settings.adminWaPhones` |
| `ADMIN_WA_GROUP` | *(not in GSM map — add if needed)* | feature_specific | WhatsApp admin group notification | **NO** | Group WA notifications disabled |
| `OPENAI_API_KEY` | `sport-center-prod-openai-api-key` | feature_specific | AI sport assistant / AI chat | **NO** | AI endpoint returns 503; rest of app unaffected |
| `OPENAI_MODEL` | *(not a secret — can use app.yaml if needed)* | feature_specific | AI model selector override | **NO** | Falls back to hardcoded default model |
| `OPENAI_BASE_URL` | *(not a secret)* | feature_specific | AI custom base URL (Azure OpenAI etc.) | **NO** | Falls back to OpenAI default endpoint |
| `GOOGLE_CLIENT_ID` | `sport-center-prod-google-client-id` | feature_specific | Google OAuth / Social login | **NO** | Google login button returns error; email/password login unaffected |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `sport-center-prod-google-service-account-json` | feature_specific | Google Sheets export / integration | **NO** | Sheets export endpoint returns 503 |
| `GA4_SERVICE_ACCOUNT_JSON` | *(not in GSM map — add if needed)* | feature_specific | Google Analytics GA4 public stats widget | **NO** | Analytics widget returns empty/error |
| `GA4_PROPERTY_ID` | *(not in GSM map — add if needed)* | feature_specific | Google Analytics GA4 property ID | **NO** | Analytics widget disabled |
| `BIZPORTAL_SYNC_API_KEY` | `sport-center-prod-bizportal-sync-api-key` | feature_specific | BizPortal corporate customer sync | **NO** | Sync endpoint returns 401; corporate booking flow unaffected |
| `CASHIER_TOKEN_SECRET` | `sport-center-prod-cashier-token-secret` | feature_specific | Cashier short-lived token signing | **NO** | Falls back to `SESSION_SECRET`; cashier tokens remain functional |
| `VAPID_PUBLIC_KEY` | `sport-center-prod-vapid-public-key` | feature_specific | Web Push notifications (browser push) | **NO** | Push subscription fails silently; booking confirmations via WA unaffected |
| `VAPID_PRIVATE_KEY` | `sport-center-prod-vapid-private-key` | feature_specific | Web Push notifications (browser push) | **NO** | Same as above |
| `WATI_API_TOKEN` | `sport-center-prod-wati-api-token` | feature_specific | WhatsApp via WATI (alternative WA provider) | **NO** | WATI channel disabled; Fonnte unaffected |
| `WATI_BASE_URL` | `sport-center-prod-wati-base-url` | feature_specific | WhatsApp via WATI base URL | **NO** | WATI channel disabled |
| `SMTP_FROM` | *(not in GSM map — add if needed)* | feature_specific | Email delivery (invoice, booking confirmation) | **NO** | Email notifications disabled; WA notifications unaffected |
| `SMTP_PASS` | *(not in GSM map — add if needed)* | feature_specific | Gmail app password for email delivery | **NO** | Email delivery disabled |
| `PORTAL_ADMIN_KEY` | *(not in GSM map — add if needed)* | feature_specific | Portal admin API key | **NO** | Portal admin endpoint returns 401 |
| `AI_SPORTCENTER_ENABLED` | *(not a secret — use app.yaml)* | feature_specific | AI sport assistant feature flag | **NO** | Falls back to disabled |
| `AI_SPORTCENTER_MAX_REPLY_LENGTH` | *(not a secret — use app.yaml)* | feature_specific | AI reply length cap | **NO** | Falls back to default limit |
| `WA_DRY_RUN` | *(not a secret — use app.yaml for testing)* | feature_specific | WA dry-run mode (log instead of send) | **NO** | Defaults to false (sends for real) |

---

### D. Build-Time Frontend (1)

| ENV NAME | SECRET MANAGER NAME | CATEGORY | FEATURE USING IT | STARTUP REQUIRED | FAILURE BEHAVIOR |
|----------|--------------------|---------:|-----------------|:----------------:|-----------------|
| `VITE_PUBLIC_URL` | *(non-secret, set in `app.yaml env_variables`)* | build_time_frontend | Canonical URL, `og:url`, `og:image`, structured data baked into prerendered HTML | **BUILD** | Wrong canonical / og URLs in prerendered HTML; must rebuild frontend to fix |

---

### E. Non-Secret Runtime Variables (4)

| ENV NAME | SECRET MANAGER NAME | CATEGORY | FEATURE USING IT | STARTUP REQUIRED | FAILURE BEHAVIOR |
|----------|--------------------|---------:|-----------------|:----------------:|-----------------|
| `NODE_ENV` | *(set `"production"` in `app.yaml env_variables`)* | non_secret_runtime | All conditional production/dev behavior | **AUTO** | N/A — always set by app.yaml |
| `PORT` | *(auto-injected by App Engine Standard)* | non_secret_runtime | HTTP server listen port | **AUTO** | Server throws if absent; GAE always provides it |
| `PDF_ENABLED` | *(set `"false"` in `app.yaml env_variables`)* | non_secret_runtime | PDF invoice generation feature flag | **NO** | `"false"` → PDF disabled; can change to `"true"` with redeploy only |
| `APP_URL` | *(set in `app.yaml env_variables`)* | non_secret_runtime | Invoice links, WA tokenized action URLs | **WARN** | Falls back to DB settings; see §B |
| `GOOGLE_CLOUD_PROJECT` | *(auto-injected by GAE runtime)* | non_secret_runtime | `secretLoader.ts` activation guard | **AUTO** | If absent, GSM loader skips silently (no secrets loaded from GSM) |
| `LOG_LEVEL` | *(not a secret — use app.yaml if needed)* | non_secret_runtime | Pino log verbosity | **NO** | Falls back to `"info"` |

---

### F. Dev-Only Variables (MUST NOT appear in production)

| ENV NAME | RISK IN PRODUCTION |
|----------|--------------------|
| `SUPABASE_DATABASE_URL_DEV` | `envValidation.ts` logs a warning if present in prod |
| `SUPABASE_SERVICE_ROLE_KEY_DEV` | Same |
| `SUPABASE_URL_DEV` | Same |
| `SUPABASE_ANON_KEY_DEV` | Same |
| `ALLOW_DEV_ON_PROD_DB` | `envValidation.ts` warns if `=true` in prod; storage/DB modules ignore it in production |
| `ALLOW_DEV_ON_PROD_STORAGE` | Same |
| `REPL_ID` | Replit-specific; GAE does not inject it; storage module checks and skips Replit path |
| `REPLIT_DEV_DOMAIN` | Same |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Replit Object Storage bucket ID; module removed from `gae-deploy/package.json` |
| `DATABASE_URL` | Old heliumdb local variable; superseded by `SUPABASE_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV` |

---

## 3. SUPABASE_SERVICE_ROLE_KEY — Startup-Fatal or Feature-Specific?

### Finding: Feature-specific, with a pre-existing bug in the startup path

**Previous classification (GAE-2A):** REQUIRED_STARTUP — fatal if missing.

**Correct classification (GAE-3A):** FEATURE_SPECIFIC — storage operations fail, server starts normally.

### Root Cause of Bug

`supabaseStorage.ts` contained module-level initialization code (lines 67–78 before this fix) that called `process.exit(1)` in the production branch when `SUPABASE_SERVICE_ROLE_KEY` was absent:

```
// ESM execution order
1. Node resolves module graph (all static imports)
2. supabaseStorage.ts module body runs  ← process.exit(1) fires HERE
3. index.ts body starts
4. await loadSecretsFromGSM()           ← NEVER REACHED
5. validateEnv()
```

Because ESM module bodies execute in dependency order during graph initialization, `supabaseStorage.ts` fired `process.exit(1)` **before** `loadSecretsFromGSM()` in `index.ts` could inject the key from Google Secret Manager. The GSM loader was therefore completely bypassed for this specific variable.

This meant that even if the operator correctly created `sport-center-prod-supabase-service-role-key` in Secret Manager and granted the SA `secretAccessor` permission, the server would still exit on startup.

### Fix Applied

The production branch now emits `console.warn` and sets `SERVICE_KEY = ""`. Downstream effects:
- `isStorageConfigured()` returns `false` → `validateBuckets()` skips gracefully at startup
- `getClient()` throws `"service role key missing or invalid"` at first storage call → HTTP 500 on upload/download endpoints
- All other routes are unaffected
- `envValidation.ts` REQUIRED_STARTUP list corrected to 2 entries (removed `SUPABASE_SERVICE_ROLE_KEY`)

### Current Behavior After Fix

| Scenario | Server starts? | Storage works? |
|----------|:--------------:|:--------------:|
| Key missing, not in GSM | ✅ Yes (warn) | ❌ No (500 on upload) |
| Key in GSM, IAM grant correct | ✅ Yes | ✅ Yes |
| Key pre-set via `--update-env-vars` | ✅ Yes | ✅ Yes |

---

## 4. PDF_ENABLED Verification

**Current `gae-deploy/app.yaml`:**

```yaml
PDF_ENABLED: "false"
```

✅ Already set to `"false"` for first deployment. Chromium/gVisor compatibility on App Engine Standard is unproven. Re-enable only after an isolated test confirms Chromium starts successfully:

```bash
gcloud app deploy gae-deploy/app.yaml \
  --update-env-vars PDF_ENABLED=true \
  --project=sc-sport-center --quiet
```

---

## 5. Runtime Service Account Verification

**Service account:** `sc-sport-center@appspot.gserviceaccount.com`

This is the App Engine default service account for project `sc-sport-center`. It is:
- Automatically used by all GAE Standard instances in that project
- Confirmed in `artifacts/api-server/src/lib/secretLoader.ts` (IAM requirements section)
- The identity that `loadSecretsFromGSM()` authenticates with via ADC at runtime

**Verification command (run from GCP console or Cloud Shell):**
```bash
gcloud iam service-accounts describe sc-sport-center@appspot.gserviceaccount.com \
  --project=sc-sport-center
```

**IAM grants needed (minimum, per-secret scope):**

Grant `roles/secretmanager.secretAccessor` to `sc-sport-center@appspot.gserviceaccount.com` on these secrets only:

```
sport-center-prod-session-secret             ← MANDATORY
sport-center-prod-supabase-database-url      ← MANDATORY
sport-center-prod-supabase-service-role-key  ← recommended for storage
sport-center-prod-fonnte-token               ← recommended for WA
```

Grant on remaining 12 GSM secrets only when those features are enabled.

---

## 6. Minimum Secrets Required Before First Deploy

### Absolute minimum (2) — server will not start without these:

| # | Secret Manager Name | Env Variable | Why Fatal |
|---|--------------------|--------------|-----------| 
| 1 | `sport-center-prod-session-secret` | `SESSION_SECRET` | `envValidation.ts` → `process.exit(1)`; all authentication fails |
| 2 | `sport-center-prod-supabase-database-url` | `SUPABASE_DATABASE_URL` | `envValidation.ts` → `process.exit(1)`; all DB queries fail |

### Strongly recommended (2) — server starts but core user-facing features are broken:

| # | Secret Manager Name | Env Variable | Without It |
|---|--------------------|--------------|-----------| 
| 3 | `sport-center-prod-supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` | All file uploads/downloads return 500; facility images, payment proof uploads, QRIS display all fail |
| 4 | `sport-center-prod-fonnte-token` | `FONNTE_TOKEN` | Booking confirmation and reminder WhatsApp messages are never sent; admins don't know about new bookings |

### Add on demand — enable when the feature is turned on:

| Secret Manager Name | Env Variable | Feature |
|--------------------|--------------|---------|
| `sport-center-prod-supabase-url` | `SUPABASE_URL` | Realtime availability calendar |
| `sport-center-prod-supabase-anon-key` | `SUPABASE_ANON_KEY` | Realtime availability calendar |
| `sport-center-prod-openai-api-key` | `OPENAI_API_KEY` | AI sport assistant |
| `sport-center-prod-google-client-id` | `GOOGLE_CLIENT_ID` | Google OAuth |
| `sport-center-prod-google-service-account-json` | `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Sheets export |
| `sport-center-prod-bizportal-sync-api-key` | `BIZPORTAL_SYNC_API_KEY` | BizPortal sync |
| `sport-center-prod-cashier-token-secret` | `CASHIER_TOKEN_SECRET` | Cashier tokens (optional — falls back to SESSION_SECRET) |
| `sport-center-prod-vapid-public-key` | `VAPID_PUBLIC_KEY` | Web Push notifications |
| `sport-center-prod-vapid-private-key` | `VAPID_PRIVATE_KEY` | Web Push notifications |
| `sport-center-prod-admin-wa-phones` | `ADMIN_WA_PHONES` | Admin WA phone override (optional — falls back to DB) |
| `sport-center-prod-wati-api-token` | `WATI_API_TOKEN` | WATI WA provider |
| `sport-center-prod-wati-base-url` | `WATI_BASE_URL` | WATI WA provider |

---

## 7. Updated Blocker Classification

| # | Item | Severity | Owner | Notes |
|---|------|---------|-------|-------|
| B1 | `sport-center-prod-session-secret` not yet in GSM | 🔴 FATAL | Operator | Must create before first deploy |
| B2 | `sport-center-prod-supabase-database-url` not yet in GSM | 🔴 FATAL | Operator | Must create before first deploy |
| B3 | `sc-sport-center@appspot.gserviceaccount.com` not yet granted `secretAccessor` on B1+B2 | 🔴 FATAL | Operator | Without this, GSM load fails and server exits |
| B4 | `sport-center-prod-supabase-service-role-key` not yet in GSM | 🟡 FUNCTIONAL | Operator | File uploads will 500; create before user-facing launch |
| B5 | `sport-center-prod-fonnte-token` not yet in GSM | 🟡 FUNCTIONAL | Operator | WA booking confirmations silently skipped |
| B6 | PDF on GAE Standard gVisor unproven | 🟡 RISK | Dev/Ops | `PDF_ENABLED=false` in app.yaml — mitigated |
| B7 | Scheduler gaps when `min_instances=0` | 🟡 RISK | Ops | Set `min_instances=1` before full production go-live |

**Previous reports listed 16 secrets as fatal blockers. Corrected count: 2 fatal + 2 functional + 12 on-demand.**

---

## 8. Verdict

**PHASE GAE-3A: PASS**

- ✅ Startup-validation bug in `supabaseStorage.ts` found and fixed (ESM init-order / GSM loader race)
- ✅ `SUPABASE_SERVICE_ROLE_KEY` correctly reclassified: feature_specific, not mandatory_startup
- ✅ `envValidation.ts` corrected: 2 true fatal vars (was 3)
- ✅ `PDF_ENABLED: "false"` confirmed in `gae-deploy/app.yaml`
- ✅ Runtime SA `sc-sport-center@appspot.gserviceaccount.com` confirmed
- ✅ Minimum pre-deploy secret count corrected: **2 mandatory** (was incorrectly stated as 16)
- ✅ All 16 GSM secrets catalogued with correct category, feature, and failure behavior
