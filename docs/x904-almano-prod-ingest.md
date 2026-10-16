# X904 production LAN ingest (ALMANO temporary gateway)

## Scope and separation
- PROD Supabase project: nzdweipzckfszczzqtuw; Edge Function: x904-lan-prod.
- CST-DEV remains xssrfshdrtdfupgqwfdw, using a different Edge Function, protected key, and tables.
- The machine is Solution X904 (serial TDBD234200545) at 192.168.100.185:4370.
- ALMANO currently authenticates over local TCP and uploads via HTTPS to PROD.
- Records are read afresh from the physical machine. Never copy the DEV database into PROD.
- The protected local Comm Key and separate PROD random ingest token remain encrypted under ALMANO's Windows DPAPI.
- Only a SHA-256 digest of the PROD token is stored in PROD: sport_center.gym_x904_lan_auth.
- Do not print, version, or upload the raw token or physical device Comm Key.

## Security and data interpretation
- API requests are accepted only for the pinned project, endpoint and device serial, after authentication.
- RLS on PROD X904 LAN tables denies direct browser access. Only the internal Sport Center backend database role has SELECT policy for published users/logs/state; it cannot read the token hash.
- Import only user PIN/UID/name/role and event PIN/UID/timestamp/index; NEVER fingerprint templates, cards, passwords, or biometric blobs.
- SDK attendance_status and verification_type are UNKNOWN, not zero or inferred.
- Historic unverified ADMS events stay in separate gym_x904_raw_events and must not be merged into authenticated snapshots.
- No device commands, enrollment, door-control changes, membership updates or financial writes.
- Snapshot publication is atomic only after database-confirmed counts match both physical counts. Duplicates are idempotent.
- Keep LAN staging separate from publicly visible completed snapshots.

## Verified 15 October 2026 (WIB)
- Direct authenticated physical read from ALMANO: 110 users, 14,210 logs, without device changes.
- PROD Edge health: 200 and databaseReady true.
- PROD ingest received a 48-byte random connector secret protected by ALMANO DPAPI; unauthorized POST returned 403.
- Real physical X904 -> ALMANO -> PROD Edge -> PROD database: durable_database_ack=true.
- PROD database: 110 users, 14,210 logs, 14,210 published, zero pending; last complete at 2026-10-14 18:58:45Z (15 October 2026 01:58:45 WIB).
- Sport Center PROD protected admin read endpoints exist; they require an authenticated admin session.
- PROD frontend browser sign-in and rendered tables must be separately verified; API/DB PASS does not imply browser E2E.

## Manual operations (until a router or site-to-site VPN gateway is implemented)
Run as the existing Windows user on ALMANO, with the existing protected local config:

Read-only device check:
  & (Join-Path $env:LOCALAPPDATA 'GymCST\X904\probe\x904-almano-prod-runner.ps1')

Real PROD resync from physical X904:
  & (Join-Path $env:LOCALAPPDATA 'GymCST\X904\probe\x904-almano-prod-runner.ps1') -Sync

Resync is explicitly on demand, NOT hourly polling. A full snapshot reads and uploads all device history; avoid redundant scheduled runs.
Validate both durable ACK from the sender and published counts/staging emptiness in PROD DB after each sync.
To rotate the token, generate a new DPAPI token and update the PROD auth hash together; never reuse a DEV token.

## Remaining deployment boundary
- ALMANO is a temporary LAN gateway, not a permanent VPN relay.
- Direct VPS access to 192.168.100.185 is a separate future project; do not forward TCP 4370 publicly.
- Hostinger /api/internal/gym-x904/lan-events remains separate and feature-flagged off; this deployment does not turn it on or weaken WAF.
