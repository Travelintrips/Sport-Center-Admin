# Isolated DEV deployment gate for X904 ↔ VMSC

Current verified state:
- GitHub Actions isolated CST-DEV mock E2E #18 PASS
- Physical X904 already answers authenticated READ-ONLY info requests through an independent scheduled heartbeat task
- There is no known isolated Sport Center DEV API container currently running on the inspected VPS
- Do NOT deploy this branch into the PROD Sport Center service or re-use PROD heartbeat credentials

## Dedicated DEV service requirements
- Separate service and port, bound to loopback behind approved HTTPS reverse proxy.
- APP_ENV=development, NODE_ENV=development, X904_VMSC_COMMANDS_DEV_ENABLED=true.
- SUPABASE_DATABASE_URL_DEV points **only** at project xssrfshdrtdfupgqwfdw.
- A newly provisioned X904_VMSC_WORKER_TOKEN_DEV secret (minimum 32 bytes).
- Per-worker secret installed on VMSC via the authorized administrator, never committed to GitHub, not shared with PROD.
- Confirm auth: missing/wrong token -> 403; disabled endpoint -> 404.
- Allow only POST /api/internal/dev/x904-vmsc/claim, POST /result, GET /receipt/:id; HTTPS.
- Enable X904_VMSC_PHYSICAL_READ_DEV=true only on the explicitly authorized VMSC worker.
- Hardware adapter supports only device_info and never writes X904.

## Release gate
1. Build the PR and provision **isolated DEV runtime**.
2. Configure worker token via official secret management. If permission control blocks this, stop; do not borrow PROD secrets or bypass.
3. Create one queued device_info job with short TTL on CST-DEV.
4. Worker claims -> physically reads device -> submits result -> reads verified receipt.
5. Check result_json.adapter='physical-readonly', readAuthenticated=true; verified receipt. Repeated callback must be idempotent.
6. Exercise disabled service, invalid auth, simulated network interruption, timeout, lease recovery and rollback.
7. Keep PR in draft until physical DEV callback/ACK and rollback proof exist. No PROD promotion until approved.
