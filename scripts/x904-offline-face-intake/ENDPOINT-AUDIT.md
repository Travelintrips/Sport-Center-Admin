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
- No physical Android/iPhone browser session available for verified on-device capture. DO NOT report physical PASS.
- The HTML stand-alone preview and integrated React page are for synthetic JPEG data only. No real gym member photo may be staged.
- Mobile verification requires tester with physical devices: visit HTTPS preview under authenticated admin route; check camera permission, image choice and validation; test valid, wrong PIN, wrong filename, >50KB, corrupt JPEG; inspect network panel/proxy and confirm no photo bytes posted to server; after tests, verify `sport_center.x904_user_commands` count/state unchanged (read-only pre/post). Use synthesized test image only.
- No deployment/merge while firmware ZMM510-NF24VB-Ver1.4.15 photo ingestion and recovery remain NO-GO. Keep `X904_SEND_ENABLED=false`.
- This code review cannot prove every endpoint or worker installed outside this repo and VMSC tree. A cross-service inventory and actual physical mobile browser verification are still release blockers.
