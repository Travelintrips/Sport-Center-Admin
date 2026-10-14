# Solution X904 / ALMANO -> Sport Center DEV

## Environment boundary

This DEV-only data path is deliberately isolated from Sport Center production.
The gateway is the CST-DEV Supabase Edge Function `x904-lan-dev`.
It rejects deployment in any Supabase project other than CST-DEV.
The local sender accepts only the exact CST-DEV HTTPS endpoint. Do not
route machine traffic to the PROD website or change X904 network settings.

## Authentication and data minimization

- Edge Function JWT validation is disabled intentionally **only** because its
  POST endpoints implement custom authentication: a random 48-byte token kept
  under the ALMANO Windows user's DPAPI and a SHA-256 token digest kept in the
  RLS-protected DEV auth table. Unauthorized requests return HTTP 403.
- The physical X904 is authenticated locally using its existing device Comm Key.
  The Comm Key, passwords, cards, biometric templates, and fingerprints must not
  be uploaded or copied into the application.
- Users: device PIN, UID, display name, and role only.
- Logs: device PIN, UID, time, and stable event index only.
- Writes are limited to isolated DEV LAN snapshot tables; no changes to member
  status, door control, access permissions, bookings, or financial data.

## Endpoints and invariants

- `GET /functions/v1/x904-lan-dev/health`: database readiness; no personal data.
- `POST /functions/v1/x904-lan-dev/api/internal/gym-x904/lan/users`: complete
  user snapshot, bounded to 500 and idempotent by device PIN.
- `POST .../logs`: batches of up to 500 records, idempotent by event SHA-256.
- `POST .../complete`: returns success only after database verifies that the
  current snapshot contains the exact reported user and device log counts.
- A failed batch never marks the snapshot complete; retry creates a new snapshot.
- Browser-facing admin routes in Sport-Center-Admin are independently protected
  by Sport Center's admin middleware. DEV records are **not** live PROD data.

## Verified read-only DEV test, 14 October 2026

The physical ALMANO connector read 110 users and 14,208 logs from X904.
The edge API accepted all data. Direct CST-DEV database verification returned:
110 users, 14,208 snapshot logs, 14,208 unique event IDs, and a durable
`verifiedStored=true` ACK. This proves LAN -> HTTPS Edge -> DEV Postgres;
it does **not** prove the production Sport Center web dashboard is deployed.

## Operations

1. Keep the ALMANO DPAPI files local. Do not paste device Comm Key or token
   into GitHub, CI logs, chat, files, or the dashboard.
2. From the owning Windows account on ALMANO, run
   `x904-almano-runner.ps1` to check read-only access, or
   `x904-almano-runner.ps1 -Sync` for an explicitly authorized DEV import.
3. Check exact counts and snapshot completion in CST-DEV before claiming PASS.
4. To rotate the token, generate a new protected key and update the DEV auth
   table digest together; revoke the previous credential.
5. Releasing to PROD requires a separate verified backup, data-retention and
   access-control review, production endpoint and credentials, deployment and
   a fresh physical-device E2E test. This DEV-only connector cannot target PROD.
