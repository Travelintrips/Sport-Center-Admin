# PHASE GAE-2A FINAL REPORT

**Date:** 2026-08-01  
**Scope:** Code, Environment, Secret, and Runtime Hardening  
**GCP Project:** sc-sport-center  
**Production Domain:** https://sc.travelintrips.co.id  
**Repository:** Travelintrips/Sport-Center-Admin  

---

## 1. Final Deployment Files

### `gae-deploy/app.yaml`
- `runtime: nodejs20`, `service: default`
- Entrypoint: `node --enable-source-maps ./dist/index.mjs`
- `env_variables`: only `NODE_ENV=production`, `VITE_PUBLIC_URL`, `PDF_ENABLED`
- **No secrets.** Full Secret Manager naming convention documented inline.
- IAM requirement documented: `roles/secretmanager.secretAccessor` on each secret.

### `gae-deploy/package.json`
- **Changed:** Removed `@replit/object-storage` (not needed in production — sidecar at 127.0.0.1:1106 does not exist on GAE)
- **Changed:** Moved `@sparticuz/chromium-min`, `puppeteer-core`, `playwright` to `optionalDependencies` (PDF may be disabled on GAE Standard)
- **Added:** `@google-cloud/secret-manager` as a regular dependency (required for ADC-based secret loading)
- Kept: `pg`, `nodemailer`, `googleapis`, `openai`, `ws`, `xlsx`

### `gae-deploy/.gcloudignore`
- No changes required. Already excludes Playwright browser binaries and test files.
- Source maps are intentionally NOT excluded (Node's `--enable-source-maps` uses them for stack traces).

### `cloudbuild.yaml`
- **Added Step 3a:** `build-libs` — builds `@workspace/db` and `@workspace/api-zod` TypeScript declaration files before typecheck
- **Added Step 3b:** `typecheck-api` — runs `pnpm --filter @workspace/api-server run typecheck`; fails the build on any TS error
- Steps 3c (`build-api`) and 4 (`build-frontend`) now depend on `build-libs`
- No secrets in any build step. Smoke test uses `SESSION_SECRET=smoke-test-secret-not-real` (clearly labeled dummy value, not a real secret).

---

## 2. Files Changed

| File | Change |
|------|--------|
| `artifacts/api-server/src/lib/pdfGenerator.ts` | Fixed `@ts-expect-error` + `document` browser-API errors (6 TS errors → 0); added `isPdfEnabled()` feature flag; Chromium download notes |
| `artifacts/api-server/src/lib/envValidation.ts` | **NEW** — centralized env validation, all variables catalogued and categorized |
| `artifacts/api-server/src/lib/secretLoader.ts` | **NEW** — Google Secret Manager ADC loader design + implementation |
| `artifacts/api-server/src/lib/__tests__/storageProvider.test.ts` | **NEW** — production-mode Replit sidecar guard test |
| `artifacts/api-server/src/index.ts` | Replaced `validateProductionEnv()` with `validateEnv()` from `envValidation.ts`; added `loadSecretsFromGSM()` call at startup |
| `artifacts/api-server/src/routes/storage.ts` | Added production guard for `/api/storage/files/` — returns 404 in production (prevents accidental sidecar connection) |
| `artifacts/api-server/tsconfig.json` | Excluded `__tests__` from main typecheck target |
| `artifacts/api-server/tsconfig.test.json` | **NEW** — separate tsconfig for test files (includes jest types) |
| `gae-deploy/package.json` | Removed `@replit/object-storage`; moved PDF deps to `optionalDependencies`; added `@google-cloud/secret-manager` |
| `cloudbuild.yaml` | Added `build-libs`, `typecheck-api` steps; updated `build-frontend` dependency |
| `lib/db/package.json` | Added `build` script (`tsc -p tsconfig.json`) |
| `lib/api-zod/package.json` | Added `build` script (`tsc -p tsconfig.json`) |

---

## 3. Typecheck Result

```
> @workspace/api-server@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit

(no output — 0 errors)
```

**Result: PASS — 0 errors**

Root cause of original errors:
1. `lib/db` and `lib/api-zod` had no `build` script — TypeScript project references require `.d.ts` output. Fixed by adding build scripts and running them in `cloudbuild.yaml` before typecheck.
2. `pdfGenerator.ts`: `document` browser API used in puppeteer `evaluateHandle` callback caused 6 errors. Fixed by passing the expression as a string literal instead of an arrow function.

---

## 4. Environment Validation Result

New centralized module: `src/lib/envValidation.ts`

### Variable Catalogue

**REQUIRED_STARTUP** (fatal in production if missing):
| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | HMAC key for auth tokens and password hashing |
| `SUPABASE_DATABASE_URL` | Primary PostgreSQL connection URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase storage — all file uploads/downloads |

> Note: The old `validateProductionEnv()` treated `SUPABASE_SERVICE_ROLE_KEY` as a *warning* only. This has been corrected to **fatal** — missing this key causes every file upload to fail in production.

**OPTIONAL** (warn in production; app degrades gracefully):
- `SUPABASE_URL` — realtime availability broadcasts
- `SUPABASE_ANON_KEY` — realtime availability broadcasts
- `APP_URL` — base URL for invoice links and WA messages

**FEATURE_SPECIFIC** (no startup check; validated at feature-call time):
`FONNTE_TOKEN`, `FONNTE_CUSTOMER_TOKEN`, `FONNTE_ADMIN_WA`, `ADMIN_WA_PHONES`, `ADMIN_WA_GROUP`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GA4_SERVICE_ACCOUNT_JSON`, `GA4_PROPERTY_ID`, `BIZPORTAL_SYNC_API_KEY`, `CASHIER_TOKEN_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WATI_API_TOKEN`, `WATI_BASE_URL`, `SMTP_FROM`, `SMTP_PASS`

**BUILD_TIME_FRONTEND** (not read at backend runtime):
- `VITE_PUBLIC_URL` — baked into frontend bundle at build time; changing domain requires a new frontend build

**RUNTIME_BACKEND** (platform-injected):
- `PORT` — injected by App Engine Standard
- `NODE_ENV` — set in `app.yaml env_variables`

### Key Rules Enforced
- Error messages never print secret values — only variable names
- Application does not fail startup due to missing FEATURE_SPECIFIC secrets
- Dev-only variables detected in production are warned, not fatal
- `ALLOW_DEV_ON_PROD_*` flags warned if present in production

---

## 5. Secret Manager Design

### Status: Design complete; ADC loader implemented at `src/lib/secretLoader.ts`

The app currently has **no existing Secret Manager client**. Secrets arrive via `process.env` only. `secretLoader.ts` adds ADC-based loading at startup:

1. Runs only when `NODE_ENV=production` AND `GOOGLE_CLOUD_PROJECT` is set (both true on GAE)
2. Calls `SecretManagerServiceClient.accessSecretVersion()` for each mapped secret
3. Injects values into `process.env` before `validateEnv()` runs
4. Skips variables already set (allows `gcloud app deploy --update-env-vars` emergency override)
5. Non-fatal per-secret — `validateEnv()` will catch any still-missing required variables

### Secret Naming Convention (`sc-sport-center` project)
| Secret Manager ID | Env Variable |
|------------------|-------------|
| `sport-center-prod-supabase-database-url` | `SUPABASE_DATABASE_URL` |
| `sport-center-prod-supabase-url` | `SUPABASE_URL` |
| `sport-center-prod-supabase-anon-key` | `SUPABASE_ANON_KEY` |
| `sport-center-prod-supabase-service-role-key` | `SUPABASE_SERVICE_ROLE_KEY` |
| `sport-center-prod-session-secret` | `SESSION_SECRET` |
| `sport-center-prod-fonnte-token` | `FONNTE_TOKEN` |
| `sport-center-prod-openai-api-key` | `OPENAI_API_KEY` |
| `sport-center-prod-google-service-account-json` | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `sport-center-prod-google-client-id` | `GOOGLE_CLIENT_ID` |
| `sport-center-prod-bizportal-sync-api-key` | `BIZPORTAL_SYNC_API_KEY` |
| `sport-center-prod-cashier-token-secret` | `CASHIER_TOKEN_SECRET` |
| `sport-center-prod-vapid-public-key` | `VAPID_PUBLIC_KEY` |
| `sport-center-prod-vapid-private-key` | `VAPID_PRIVATE_KEY` |
| `sport-center-prod-admin-wa-phones` | `ADMIN_WA_PHONES` |
| `sport-center-prod-wati-api-token` | `WATI_API_TOKEN` |
| `sport-center-prod-wati-base-url` | `WATI_BASE_URL` |

> Secrets are **NOT** created or populated in this phase. Values must be set by the operator before first deployment.

---

## 6. Runtime Service Account Recommendation

**Service Account:** `sc-sport-center@appspot.gserviceaccount.com` (App Engine default SA)

This SA is automatically used by all GAE Standard instances in the `sc-sport-center` project.

---

## 7. IAM Minimum Roles

### App Engine Default SA (`sc-sport-center@appspot.gserviceaccount.com`)
| Role | Scope | Purpose |
|------|-------|---------|
| `roles/secretmanager.secretAccessor` | Per-secret (each of the 16 secrets listed above) | Read secrets at runtime via ADC |

**Do NOT grant:**
- `roles/secretmanager.admin` (project-wide) — excessive
- `roles/secretmanager.secretVersionManager` — not needed

### Cloud Build SA (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`)
| Role | Scope | Purpose |
|------|-------|---------|
| `roles/appengine.deployer` | Project | Deploy to App Engine |
| `roles/storage.objectCreator` | GAE staging bucket | Upload build artifacts |
| `roles/cloudbuild.builds.builder` | Project | Default — already granted |

**Cloud Build SA does NOT need Secret Manager access** — runtime secrets are loaded by the GAE instance, not during build.

---

## 8. Storage Compatibility Result

### Audit Summary

| Location | Uses Replit Storage | Risk in Production |
|----------|--------------------|--------------------|
| `src/lib/storage.ts` | Guarded: `!IS_PRODUCTION && isReplitStorageAvailable()` | ✅ None — production never routes here |
| `src/lib/replitStorage.ts` | Core implementation | ✅ Safe — imported but never called when IS_PRODUCTION=true |
| `src/routes/storage.ts` | `/api/storage/files/` GET route | ⚠️ **Fixed** — added production guard (returns 404 with explanation) |
| `src/lib/__tests__/storageProvider.test.ts` | Test assertions | ✅ Confirms production guard logic |

### Key Finding
The `/api/storage/files/:folder/:filename` endpoint called `downloadFromReplitStorage()` without checking `NODE_ENV`. In production on GAE, this would attempt to connect to `127.0.0.1:1106` (Replit Object Storage sidecar), which does not exist, causing a connection error for any legacy relative URLs stored in the database. **Fixed** with production guard.

### Production Architecture
- All uploads → Supabase Storage (absolute public URLs)
- `@replit/object-storage` removed from `gae-deploy/package.json`
- No silent fallbacks in production — upload throws clearly if Supabase fails
- Old files with relative `/api/storage/files/...` URLs: these exist only in dev data; migration not in scope per instructions

---

## 9. PDF Compatibility Result

### Audit Summary

| Component | File | Status |
|-----------|------|--------|
| `@sparticuz/chromium-min` | `pdfGenerator.ts`, `documentTemplates.ts` | ⚠️ **Unproven on GAE Standard** |
| `puppeteer-core` | Same | ⚠️ Unproven |
| `playwright` | Imported as external, no usage found in source | ℹ️ No actual usage — only declared as dep |
| Temp files | None used explicitly — chromium download writes to system temp | `/tmp` is 256MB tmpfs on GAE Standard ✅ |
| Execution | Lazy — not called at startup | ✅ Startup not affected |
| Error handling | `try/catch` in both call sites | ✅ API does not crash on PDF failure |

### App Engine Standard Compatibility Risk

App Engine Standard runs in a **gVisor sandbox** (on newer runtimes). Chromium requires kernel features (`/proc/self/exe`, `setuid`, `clone` flags) that **gVisor restricts**. Even with `--no-sandbox`, certain syscalls may be blocked.

**Known data point:** `@sparticuz/chromium-min` targets Lambda/Cloud Run (Linux x86_64, 256MB+ RAM, `/tmp` writable). It is NOT officially tested against App Engine Standard gVisor.

### Risk Mitigation Implemented

1. **`isPdfEnabled()` function** added to `pdfGenerator.ts` — checks `PDF_ENABLED` env var
2. **`PDF_ENABLED=true`** is set in `app.yaml` — can be changed to `false` with a re-deploy (no code change needed)
3. **Lazy loading** — Chromium binary is downloaded at first PDF request, not at startup. Server starts successfully regardless.
4. **`optionalDependencies`** in `gae-deploy/package.json` — if install fails, app still runs (PDF just unavailable)
5. **Error handling** — both `invoiceDelivery.ts` and `documentTemplates.ts` catch puppeteer errors and fall back gracefully

### Verdict on PDF: **NOT PROVEN COMPATIBLE with GAE Standard**

**Recommendation:** 
- Keep `PDF_ENABLED=true` for first deployment and monitor logs
- If PDF generation fails, set `PDF_ENABLED=false` in `app.yaml` and re-deploy
- For guaranteed PDF support, use **Cloud Run** (Flexible, no gVisor) as a dedicated PDF worker service

---

## 10. Blockers Remaining

| # | Blocker | Severity | Owner |
|---|---------|----------|-------|
| B1 | Secret values not yet created in Google Secret Manager | 🔴 FATAL before first deploy | Operator |
| B2 | App Engine default SA not yet granted `roles/secretmanager.secretAccessor` | 🔴 FATAL before first deploy | Operator |
| B3 | `@google-cloud/secret-manager` added to `gae-deploy/package.json` but not yet in `pnpm-lock.yaml` — run `pnpm install` in workspace to update lockfile before committing | 🟡 Required before next Cloud Build run | Dev |
| B4 | PDF compatibility on GAE Standard is unproven | 🟡 Risk — mitigated by feature flag | Dev/Ops |
| B5 | `APP_URL` must be set to `https://sc.travelintrips.co.id` in production env (via Secret Manager or `--update-env-vars`) for correct invoice and WA message links | 🟡 Functional degradation if missing | Operator |

---

## 11. Verdict

**PASS WITH BLOCKERS**

- ✅ Deployment files: clean — no secrets, no hardcoded credentials, no Replit-only deps
- ✅ TypeScript typecheck: **0 errors** (was failing on `lib/db` build + `pdfGenerator.ts` browser API)
- ✅ Environment validation: centralized, categorized, production-safe
- ✅ Secret Manager: design complete, ADC loader implemented (`secretLoader.ts`)
- ✅ Storage: Replit Object Storage correctly excluded from production; `/api/storage/files/` endpoint guarded
- ⚠️ PDF/Chromium: not proven on App Engine Standard — feature flag in place, error-isolated
- 🔴 B1, B2: secrets must be created in GSM before first deployment
- 🟡 B3: run `pnpm install` to update lockfile after `gae-deploy/package.json` change
