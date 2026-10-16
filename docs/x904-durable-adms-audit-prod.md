# Solution X904 ADMS: persistent privacy-safe protocol audit (PROD)

## Purpose

Record the ADMS protocol attempts received by the **Sport Center Hostinger Web Apps backend** in the **Sport Center PROD Supabase** database. This is needed because the separate Hostinger VPS's Nginx logs do not contain Sport Center Web Apps requests.

This is **not** a device authentication mechanism or an approval to import ATTLOG. A client can claim a device serial, User-Agent and source IP. The physical X904 cannot be considered authenticated from a claimed serial/ADMS response.

## PROD storage and isolation

- Supabase PROD: nzdweipzckfszczzqtuw.
- Additive migration: docs/sql/gym-x904-adms-durable-audit-prod.sql
- Table: sport_center.gym_x904_adms_audit
- Backend role sport_center_app receives INSERT and SELECT only, with RLS policies.
- anon/authenticated/public roles have no table permissions; users can read it only through the existing adminMiddleware protected endpoint.
- The table stores **received_at, protocol kind, coarse outcome, method, coarse client_hint, body byte count, row count, and connector_authorized**. Additive 2026-10-15 schema includes `attlog_parseable` and `attlog_min_columns` for privacy-safe grammar diagnostics, without persisting event values. No raw URL, serial, IP, User-Agent, PIN, identity, name, card, biometric, body, token or payload is stored.
- device_identity_verified is always false in this flow and database CHECK enforces that invariant.
- Writes from requests that pass the claimed serial match are rate-limited per outcome/client class per server process. It may omit repeated requests within the sample interval; it is a diagnostic history, not lossless packet capture.
- A database audit write failure increments transient counters but **must not** falsely ACK an untrusted attendance upload.

## Inspection via Supabase (directly through authenticated Desktop Commander/ChatGPT Supabase tool)

SELECT received_at, kind, outcome, method, client_hint, row_count, connector_authorized, device_identity_verified
FROM sport_center.gym_x904_adms_audit
ORDER BY received_at DESC, id DESC
LIMIT 40;

A row showing kind=handshake and outcome=configuration_sent proves only that the server processed a request *claiming* the configured serial. It does not establish that the physical machine sent it.

Check inbound attendance attempts:

SELECT received_at, outcome, client_hint, row_count
FROM sport_center.gym_x904_adms_audit
WHERE kind='attendance'
ORDER BY received_at DESC
LIMIT 20;

## Admin UI

The Audit & Diagnostik and device tabs in SC now read /api/admin/gym-x904/adms-audit (Bearer admin token). A separate live-memory panel is still available; do not confuse the ephemeral process values with durable database history.

## Deployment and validation

The Hostinger Release Verification GitHub workflow **verifies only and does not deploy**. Merge to main is not proof that Web Apps loaded the new code. Verify by hitting the recognized ADMS handshake via HTTPS, using a recognizable synthetic client User-Agent and **no personal attendance data**:

curl --silent --show-error --max-time 15 -D - -o /dev/null -A 'curl/x904-audit-readonly-smoke'
  'https://sc.travelintrips.co.id/iclock/cdata?SN=TDBD234200545&options=all'

Only after the actual new Web Apps release, the response from a valid SN returns the header: X-X904-ADMS-Audit: db-v1. The backend should then insert one unverified handshake audit row into PROD. Use the Supabase SELECT above to confirm a row appears *after* the request time and is client_hint=automation-like; this is a **real Web Apps→PROD database audit write**.

No anonymous client may access /api/admin/gym-x904/adms-audit (must be 401/403). Unsupported operations still return 404; untrusted ATTLOG still returns a failure rather than a success ACK. This project never changes machine IP, door controls, user enrollment, membership, finance, Wi-Fi or Hostinger WAF settings.

## Remaining hardware verification

For actual X904→Web Apps ADMS E2E, independently observe an X904-originated packet and establish physical identity through a trusted gateway/attestation. This database audit alone is insufficient. Until then, keep ALMANO's physically authenticated LAN read-only sync available.
