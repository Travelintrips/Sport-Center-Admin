# X904 HTTP / executor boundary audit (31 October 2026)

Scope: source review of X904-related routers under `artifacts/api-server/src/routes`, one automatic command worker, and VMSC executors; database constraints from read-only PROD SQL. This is **not** a comprehensive inventory of all application HTTP routes.

## HTTP entrypoints, relative to the API router
- `gymX904Integration.ts`: POST /internal/gym-x904/connector-heartbeat; GET /admin/gym-x904/{integration,users,read-command}; POST /admin/gym-x904/{read-command,user-command,delete-batches,pin200-payment-test}; GET /admin/gym-x904/{delete-batches,delete-batches/:batchId,confirmed-auto-suspensions,user-command/capabilities,live-access-status,manual-access-status,manual-access-pending,user-command-recent,user-command/:commandId}; GET /internal/gym-x904/diagnostics/command/:commandId.
- `gymX904Events.ts`: POST /internal/gym-x904/{events,lan-events,wa-delivery-ack}; GET /admin/gym-x904/{lan-reconciliation,daily-scan-audit,event-review,device-events,observed-pins,member-mapping,cross-system-reconciliation}.
- `gymX904Lan.ts`: POST /internal/gym-x904/lan/{users,logs,complete}; GET /admin/gym-x904/{lan-status,lan-users,lan-logs}.
- `gymX904Attested.ts`: POST /internal/gym-x904/vmsc/attest.
- `x904AdmsGate.ts`: GET /api/admin/gym-x904/{adms-diagnostic,adms-audit}; iClock diagnostic ingress through `/iclock`, including /cdata and /getrequest. Check mount path carefully because this router declares absolute /api routes.
- Browser-only route: `/admin/gym-x904/face-offline`. Contains no API call and no upload request.

## Dispatch findings
- `x904AutomaticCommandWorker.ts` may queue access-group commands from verified membership entitlement events. It is NOT a photo flow; do not disable the existing worker.
- VMSC `x904-vmsc-user-command-executor.mjs` allows CREATE_USER, UPDATE_USER, DELETE_USER; separate VMSC group executor allows SUSPEND_USER, ACTIVATE_USER. Both connect/write for established non-photo access workflows under separate guards.
- PROD `sport_center.x904_user_commands` CHECK limits command_type to CREATE_USER, UPDATE_USER, DELETE_USER, SUSPEND_USER, ACTIVATE_USER; no photo command exists in this queue. Unique idempotency_key.
- Read-only query inspected 18 `sport_center.x904_*` PostgreSQL functions and found no 'face' or 'photo' literal in those definitions. This does NOT rule out unrelated schema functions, triggers, direct device traffic, or external services.
- New face preview only reads local File objects, decodes in browser and hashes bytes. No storage, queue, network or machine dispatch.

## Limits / release gates
- Physical Android browser test: PASS based on supplied handset screenshot. Result: STAGED_OFFLINE_ONLY; original 1,037,085 bytes; compressed 37,338 bytes; output 720 × 1280; SHA-256 displayed.
- Physical iPhone browser test: PASS based on supplied iPhone/Safari screenshot. Result: STAGED_OFFLINE_ONLY; original 1,635,720 bytes; compressed 36,533 bytes; output 960 × 1280; SHA-256 displayed.
- Laptop browser test: PASS based on supplied screenshot. Result: STAGED_OFFLINE_ONLY; original 56,732 bytes; compressed 43,847 bytes; output 864 × 1152.
- These screenshots prove the browser workflow and local compression path; they do not independently prove that the selected image content was synthetic, nor do they include a captured network trace or before/after database queue census.
- The HTML stand-alone preview and integrated React page are for synthetic JPEG data only. No real gym member photo may be staged.
- Remaining mobile security verification: capture a network trace/proxy showing no photo bytes leave the browser and compare `sport_center.x904_user_commands` read-only count/state before and after the test. Verify test fixtures are synthetic only; do not use member photos.
- No deployment/merge while firmware ZMM510-NF24VB-Ver1.4.15 photo ingestion and recovery remain NO-GO. Keep `X904_SEND_ENABLED=false`.
- This code review cannot prove every endpoint or worker installed outside this repo and VMSC tree. A cross-service inventory and actual physical mobile browser verification are still release blockers.


## 2026-11-02 follow-up evidence (read-only)
- VPS headless Chromium test against the public standalone preview using a generated synthetic JPEG fixture completed:
  - Input fixture: 1,687,683 bytes.
  - Result: `STAGED_OFFLINE_ONLY`.
  - Output: 37,677 bytes, 470 × 627.
  - SHA-256 displayed: `88e54cf96ef2980da8263cc99fa8b9ed9acaa58df7808bc738cb2585b5eaa672`.
  - Network capture: 7 requests were observed while loading the raw.githack intermediary (preview document and provider/interstitial requests, including ethicalads). After the actual preview app document had loaded, selecting and compressing the synthetic file produced **0 additional requests**; no POST/request body containing photo bytes was observed. The intermediary's unrelated pre-app requests mean the entire navigation is not literally zero-network.
  - Result: browser-app photo-processing network isolation PASS in this headless VPS test; physical Android-specific network trace remains NOT VERIFIED.
- Read-only PROD queue census:
  - Before snapshot: 2026-11-02 08:23:35.231788 UTC; counts = ACTIVATE_USER 4 completed + 1 failed, DELETE_USER 3 cancelled + 7 completed + 2 failed, SUSPEND_USER 14 completed (31 total).
  - After snapshot: 2026-11-02 08:26:27.566443 UTC; same counts in every category; `created_since_baseline=0` for all command types/states.
  - Result: no new `sport_center.x904_user_commands` rows observed in the interval. This is temporal evidence around the VPS browser test; it is not proof about the earlier physical handset screenshots.
- No queue payloads, PINs, or member data were selected in these census queries.
- X904 database E2E remains SKIPPED; no device command was issued and no settings were changed.
