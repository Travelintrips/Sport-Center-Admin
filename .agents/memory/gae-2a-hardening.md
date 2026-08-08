---
name: GAE-2A hardening
description: Phase GAE-2A outcomes — TypeScript fix, env validation, Secret Manager loader, storage guard, PDF flag
---

# GAE-2A Hardening Results

## TypeScript project references require lib builds first
`lib/db` and `lib/api-zod` have `composite: true` and emit `.d.ts` to `dist/`. Before running `api-server` typecheck, run:
```
pnpm --filter @workspace/db run build
pnpm --filter @workspace/api-zod run build
```
Both now have `"build": "tsc -p tsconfig.json"` scripts. `cloudbuild.yaml` has a `build-libs` step.

**Why:** api-server's tsconfig uses `"references"` which requires pre-built declaration files.

## pdfGenerator.ts — evaluateHandle browser context
`page.evaluateHandle()` accepts a string expression — use this instead of an arrow function to avoid TypeScript trying to resolve browser APIs (`document.fonts`) in Node.js context.

**Why:** `@ts-expect-error` was stale (the error it was supposed to suppress changed form); string avoids the issue entirely.

## New modules added
- `src/lib/envValidation.ts` — centralized env validation, all vars catalogued
- `src/lib/secretLoader.ts` — ADC-based Google Secret Manager loader; runs at startup in production before validateEnv()
- `src/lib/__tests__/storageProvider.test.ts` — production sidecar guard tests

## Production storage guard
`routes/storage.ts` `/api/storage/files/` endpoint now returns 404 in production. This endpoint serves Replit Object Storage files (dev-only); in production all files are Supabase Storage absolute URLs.

## PDF feature flag
`isPdfEnabled()` in `pdfGenerator.ts` checks `PDF_ENABLED` env var. Set `PDF_ENABLED=false` in `app.yaml` if Chromium is incompatible with GAE Standard gVisor sandbox. Current setting: `PDF_ENABLED=true`.

## gae-deploy/package.json changes
- Removed `@replit/object-storage` (sidecar not available on GAE)
- Moved `@sparticuz/chromium-min`, `puppeteer-core`, `playwright` to `optionalDependencies`
- Added `@google-cloud/secret-manager` for ADC loader

## Blockers before first GAE deploy
1. Create 16 secrets in Google Secret Manager (`sport-center-prod-*`)
2. Grant `sc-sport-center@appspot.gserviceaccount.com` → `roles/secretmanager.secretAccessor` on each
3. Set `APP_URL=https://sc.travelintrips.co.id` in production env

## tsconfig test exclusion
`artifacts/api-server/tsconfig.json` excludes `__tests__` — use `tsconfig.test.json` for running tests with jest types.
