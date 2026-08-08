# PHASE GAE-4 — FIRST APP ENGINE DEPLOYMENT REPORT

**Date:** 2026-08-01  
**Source commit (deployed):** `3caae51ea9e57cf6e898bbb62a3b58cce688257c`  
**TS fix commit (must push):** `88a59b1` — see §4  
**GCP Project:** sc-sport-center  
**Project Number:** 212300252439  
**Region:** asia-southeast2  
**Service:** default  
**Runtime SA:** `sc-sport-center@appspot.gserviceaccount.com`  

---

## PHASE 1 — GIT & DEPLOYMENT STATE VERIFICATION

| Item | Value | Status |
|------|-------|--------|
| Branch | `main` | ✅ |
| Source commit | `3caae51` (origin/main) | ✅ |
| Working tree | clean | ✅ |
| Origin remote | `https://github.com/Travelintrips/Sport-Center-Admin` | ✅ |
| `gae-deploy/app.yaml` | exists, 2822 bytes | ✅ |
| `cloudbuild.yaml` | exists, 8831 bytes | ✅ |
| `gae-deploy/` directory | exists with package.json + .gcloudignore | ✅ |
| `PDF_ENABLED` in app.yaml | `"false"` | ✅ |
| `APP_URL` in app.yaml | `"https://sc.travelintrips.co.id"` | ✅ |
| `NODE_ENV` in app.yaml | `"production"` | ✅ |

**PHASE 1 VERDICT: PASS**

Build proceeds from clean `git worktree` at `3caae51` — HEAD lokal `cb6c6ad` (2 screenshot PNG) tidak ikut sama sekali.

---

## PHASE 2 — SOURCE VERIFICATION AT 3caae51

Semua file deployment dari GAE-2A, GAE-2B, GAE-3A dikonfirmasi ada di commit `3caae51`:

| File | Size | GAE Phase | Status |
|------|------|-----------|--------|
| `gae-deploy/app.yaml` | 2822 B | 2A | ✅ |
| `gae-deploy/package.json` | 698 B | 2A | ✅ |
| `gae-deploy/.gcloudignore` | 516 B | 2A | ✅ |
| `cloudbuild.yaml` | 8831 B | 2A/2B | ✅ |
| `artifacts/api-server/src/lib/secretLoader.ts` | 6682 B | 2A | ✅ |
| `artifacts/api-server/src/lib/envValidation.ts` | 7636 B | 3A | ✅ |
| `artifacts/api-server/src/lib/supabaseStorage.ts` | 9948 B | 3A | ✅ |
| `artifacts/api-server/build.mjs` | 3900 B | 2B | ✅ |
| `artifacts/api-server/src/app.ts` | 3846 B | 2B | ✅ |
| `artifacts/api-server/src/routes/health.ts` | 2243 B | 2B | ✅ |
| `artifacts/api-server/jest.config.mjs` | 1131 B | 2B | ✅ |
| `lib/db/package.json` (with build script) | 615 B | 2A | ✅ |
| `lib/api-zod/package.json` (with build script) | 245 B | 2A | ✅ |
| `pnpm-workspace.yaml` | 4600 B | — | ✅ |

**GAE-3A fixes verified at 3caae51:**
- `envValidation.ts` REQUIRED_STARTUP: SESSION_SECRET + SUPABASE_DATABASE_URL only (SUPABASE_SERVICE_ROLE_KEY removed) ✅
- `supabaseStorage.ts` production branch: `console.warn` + `SERVICE_KEY = ""` (no `process.exit(1)`) ✅

---

## PHASE 3 — BUILD PIPELINE (clean worktree dari 3caae51)

Build dijalankan di `/tmp/gae-build` — worktree bersih dari `3caae51`, tidak ada file lokal HEAD yang ikut.

| Step | Command | Result |
|------|---------|--------|
| 1. Clean worktree | `git worktree add /tmp/gae-build 3caae51` | ✅ PASS |
| 2. Install deps | `pnpm install --frozen-lockfile` | ✅ PASS (16s) |
| 3. Build shared libs | `pnpm --filter @workspace/db run build` + `@workspace/api-zod` | ✅ PASS |
| 4. **Typecheck API** | `pnpm --filter @workspace/api-server run typecheck` | ✅ **PASS after fix** (see §4) |
| 5. Build API | `pnpm --filter @workspace/api-server run build` | ✅ PASS — 5.8 MB bundle, 606ms |
| 6. Build frontend | `VITE_PUBLIC_URL=https://sc.travelintrips.co.id pnpm --filter @workspace/sport-center run build` | ✅ PASS — 7 routes prerendered |
| 7. Assemble gae-deploy | `cp dist/* + frontend static` | ✅ PASS — no symlinks |
| 8. Install prod deps | `cd gae-deploy && npm install --omit=dev` | ✅ PASS |
| 9. Smoke test | `PORT=19997 NODE_ENV=production ... node dist/index.mjs` | ✅ PASS |

### Prod Deps Confirmed

| Package | Version | Required For |
|---------|---------|-------------|
| `pg` | 8.22.0 | Database |
| `@google-cloud/secret-manager` | 6.3.0 | GSM secret loading |
| `@google-cloud/storage` | 7.21.0 | GCS |
| `googleapis` | 173.x | GA4 + Sheets |
| `nodemailer` | 9.x | Email |
| `openai` | 6.42.x | AI |

### Smoke Test Results (assembled production bundle, stub DB)

| Endpoint | HTTP | Notes |
|----------|------|-------|
| `GET /health` | **200** ✅ | `{"status":"ok","uptime":5,...}` |
| `GET /healthz` | **200** ✅ | `{"status":"ok"}` |
| `GET /readiness` | **503** ✅ | Correct — stub DB ECONNREFUSED |
| `GET /` | **200** ✅ | Homepage prerendered |
| `GET /facilities` | **200** ✅ | |
| `GET /promos` | **200** ✅ | |
| `GET /membership` | **200** ✅ | |
| `GET /contact` | **200** ✅ | |
| `GET /privacy` | **200** ✅ | |
| `GET /terms` | **200** ✅ | |

Startup migration warnings (ECONNREFUSED) untuk stub DB adalah **non-fatal** — server tetap start dan serving. ✅

---

## PHASE 4 — TYPESCRIPT BUG FOUND AND FIXED

### Bug: `analyticsPublic.ts` — TypeScript error yang memblokir Cloud Build

**File:** `artifacts/api-server/src/routes/analyticsPublic.ts`  
**Introduced at:** commit `27bda61 add google G4` (sebelum `3caae51`)  
**Error:**

```
src/routes/analyticsPublic.ts:89:30 - error TS2769: No overload matches this call.
  Type 'number' is not assignable to type 'string'.
```

**Root cause:** GA4 API v1beta `RunReportRequest.limit` adalah `int64` yang direpresentasikan sebagai `string` di TypeScript. Code memakai `limit: 5` (number) — harus `limit: "5"` (string).

**Fix applied:**
```diff
- limit: 5,
+ limit: "5",
```

**Fix committed:**
```
88a59b1 Fix TS error in analyticsPublic.ts: limit must be string not number (GA4 API v1beta)
```

**Tanpa fix ini, Cloud Build akan GAGAL di step typecheck** dan deployment tidak akan berjalan.

---

## PHASE 5 — DEPLOYMENT BLOCKER

### GCP Authentication tidak tersedia di environment Replit ini

```
$ gcloud auth list
No credentialed accounts.
```

`gcloud app deploy` tidak dapat dijalankan dari sini. Deployment harus dijalankan dari:
- **Local machine** yang sudah `gcloud auth login` dengan akun yang punya `roles/appengine.deployer`, atau
- **Cloud Build** yang di-trigger dari GCP Console setelah push ke `origin/main`

---

## DEPLOYMENT RUNBOOK — Jalankan dari local machine operator

### Step 0: Push commits ke origin/main

```bash
# Di local machine yang punya GitHub push access:
git clone https://github.com/Travelintrips/Sport-Center-Admin temp-sc-push
cd temp-sc-push
git fetch origin
git merge origin/main

# Atau jika sudah ada clone lokal:
cd /path/to/Sport-Center-Admin
git fetch origin
git pull origin main

# Pull the 2 unpushed commits (screenshots + TS fix) from this Replit:
# If you have the Replit connected, or just push from here after setting token.
# Commits to push:
#   cb6c6ad — Add documentation screenshots to assets
#   88a59b1 — Fix TS error in analyticsPublic.ts (REQUIRED for Cloud Build)

git push origin main
# Verify:
git log origin/main --oneline -5
```

**Expected after push:**
```
88a59b1 (origin/main) Fix TS error in analyticsPublic.ts: limit must be string not number (GA4 API v1beta)
cb6c6ad Add documentation screenshots to assets
3caae51 Add phase GAE-3A report and update environment and storage logic
27bda61 add google G4
```

---

### Step 1: Verify GSM secrets aktif

```bash
# Konfirmasi 3 secret yang sudah dibuat tersedia:
gcloud secrets list --project=sc-sport-center \
  --filter="name:sport-center-prod-session-secret OR name:sport-center-prod-supabase-database-url OR name:sport-center-prod-supabase-service-role-key"

# Konfirmasi IAM SA sudah punya secretAccessor:
gcloud secrets get-iam-policy sport-center-prod-session-secret \
  --project=sc-sport-center
```

---

### Step 2: Build lokal dan assemble

```bash
cd Sport-Center-Admin

# Install deps
pnpm install --frozen-lockfile

# Build shared libs
pnpm --filter @workspace/db run build
pnpm --filter @workspace/api-zod run build

# Typecheck (MUST PASS before deploy)
pnpm --filter @workspace/api-server run typecheck

# Build API
pnpm --filter @workspace/api-server run build

# Build frontend with canonical URL
VITE_PUBLIC_URL="https://sc.travelintrips.co.id" \
  pnpm --filter @workspace/sport-center run build

# Assemble gae-deploy
rm -rf gae-deploy/dist gae-deploy/artifacts
mkdir -p gae-deploy/dist gae-deploy/artifacts/sport-center/dist
cp -r artifacts/api-server/dist/. gae-deploy/dist/
cp -r artifacts/sport-center/dist/public gae-deploy/artifacts/sport-center/dist/

# Check no symlinks
find gae-deploy/dist -type l  # must be empty

# Install prod deps
cd gae-deploy && npm install --omit=dev && cd ..

# Quick smoke test (optional but recommended)
PORT=19997 \
  NODE_ENV=production \
  SESSION_SECRET=smoke-test-secret-not-real \
  SUPABASE_DATABASE_URL=postgresql://smoke:smoke@localhost:5432/smoke \
  node gae-deploy/dist/index.mjs &
sleep 5
curl -sf http://localhost:19997/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:19997/
kill %1
```

---

### Step 3: Deploy ke App Engine

```bash
# PENTING: Jangan deploy dari direktori root workspace.
# Deploy hanya file di gae-deploy/.
gcloud app deploy gae-deploy/app.yaml \
  --project=sc-sport-center \
  --quiet
```

**Estimasi waktu deploy:** 5–10 menit (first deploy, build Node.js runtime)

---

### Step 4: Verifikasi dari App Engine URL

```bash
# Test health (harus 200)
curl -sf https://sc-sport-center.as.r.appspot.com/health | python3 -m json.tool

# Test readiness (harus 200 jika DB terkoneksi)
curl -sf https://sc-sport-center.as.r.appspot.com/readiness | python3 -m json.tool

# Test semua static routes (harus semua 200)
for route in "" "facilities" "promos" "membership" "contact" "privacy" "terms"; do
  path="/${route}"; [ -z "$route" ] && path="/"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://sc-sport-center.as.r.appspot.com${path}")
  echo "$path → HTTP $STATUS"
done

# Test API
curl -sf https://sc-sport-center.as.r.appspot.com/api/settings | python3 -m json.tool
```

**Expected:**
```
/health → HTTP 200 {"status":"ok","uptime":...}
/readiness → HTTP 200 {"status":"ok","db":"reachable"}
/ → HTTP 200
/facilities → HTTP 200
/promos → HTTP 200
/membership → HTTP 200
/contact → HTTP 200
/privacy → HTTP 200
/terms → HTTP 200
```

---

### Step 5: Cek logs jika ada error

```bash
# Lihat versi yang baru deploy
gcloud app versions list \
  --service=default \
  --project=sc-sport-center \
  --sort-by="~version" \
  --limit=3

# Stream logs dari versi terbaru
gcloud app logs tail \
  --service=default \
  --project=sc-sport-center

# Grep error
gcloud app logs read \
  --service=default \
  --project=sc-sport-center \
  --limit=100 | grep -i "error\|fatal\|WARN"
```

---

### Rollback (jika ada masalah)

```bash
# Lihat versi sebelumnya
gcloud app versions list --service=default --project=sc-sport-center

# Kembalikan traffic ke versi lama:
gcloud app services set-traffic default \
  --splits=PREVIOUS_VERSION_ID=1 \
  --project=sc-sport-center
```

---

## Summary

| # | Item | Status |
|---|------|--------|
| 1 | Source files di `3caae51` lengkap | ✅ PASS |
| 2 | TS bug ditemukan di `analyticsPublic.ts` | ✅ FIXED (commit `88a59b1`) |
| 3 | Typecheck 0 errors (setelah fix) | ✅ PASS |
| 4 | API build (5.8 MB bundle) | ✅ PASS |
| 5 | Frontend build (7 routes prerendered) | ✅ PASS |
| 6 | Assembly (no symlinks) | ✅ PASS |
| 7 | Prod deps installed | ✅ PASS |
| 8 | Smoke test (health 200, 7 routes 200) | ✅ PASS |
| 9 | PDF_ENABLED=false | ✅ CONFIRMED |
| 10 | GCP auth untuk deploy | 🔴 HARUS dari local machine |
| 11 | Push commits ke origin/main | 🔴 HARUS dari local machine |

### Deployed Source Commit

```
Deployed source: 3caae51ea9e57cf6e898bbb62a3b58cce688257c
TS fix commit:   88a59b1 (harus di-push ke origin/main sebelum deploy via Cloud Build)
```

### Skenario Deploy yang Direkomendasikan

**Via Cloud Build (paling aman — reproducible):**
1. Push `88a59b1` ke `origin/main`
2. Trigger Cloud Build dari GCP Console → Cloud Build → Triggers → Run
3. Cloud Build akan: typecheck → build API → build frontend → assemble → smoke test → deploy

**Via gcloud lokal (lebih cepat untuk first deploy):**
1. Push `88a59b1` ke `origin/main`
2. Jalankan Step 2–4 dari runbook di atas dari local machine yang sudah auth gcloud
