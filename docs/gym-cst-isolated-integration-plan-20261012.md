# Gym CST integration into Sport Center (development only)

Status: integration contract / NOT deployed. Production SC and public /gym unchanged.

## Goal
The existing Sport Center Admin Portal owns navigation and login. Gym-specific attendance and device operations are supplied by a separate Gym service through a narrowly scoped server-to-server API. Do not iframe an unauthenticated dashboard or copy a static HTML demo into SC.

## Boundaries
- SC remains the source of truth for existing members, membership validity, bookings and payments.
- Gym owns attendance visit events, device connection health and audit records; no direct write to SC DB.
- Member ID mapping should be stable SC IDs, not phone, name, or card number. Default to read-only sync with explicit scope and pagination.
- Do not introduce Gym revenue calculations in SC or create duplicate invoices.
- Do not reuse SC production secrets in DEV; never expose service or X904 credentials to browser clients.
- Restrict routes/actions by existing SC session and explicit gym permissions. Server-side enforcement mandatory.
- Prevent cross-service incidents with request timeouts, circuit breaking, separate DB credentials, resource limits, safe read-only degradation.
- Feature flag gym module OFF by default; roll out to Owner and authorized Admin first.
- Keep existing /gym public marketing/facility route and existing Member Gym menu unchanged until validated.

## Proposed navigation
Sport Center Admin -> Gym -> Overview, Attendance, X904 Device, Reports.
The existing Member Gym link remains where it is; new screens should deep-link to it rather than duplicate member CRUD.

## X904
Device firmware menu confirms ADMS/HTTPS mode but protocol and proprietary records have not been verified. Do not change the physical device cloud URL, send control commands, export biometrics or expose TCP 4370 publicly. ADMS receiver is a distinct authenticated, HTTPS-reachable edge of Gym once compatibility tests pass; simulate before production.

## Acceptance gates
1. Audit SC auth, actual Member Gym data model/routes and environment boundaries.
2. Contract tests for gym-sc member mapping, authz, missing service, invalid events and replay.
3. UI and accessibility test on desktop and mobile, protected routes.
4. Independent SC regression tests for bookings, payments, corporate invoices, and public /gym.
5. DEV integration and rollback test with gym feature flag; only then production approval.

## Login decision (2026-10-12)
Gym management must reuse the existing Sport Center Admin login, including the existing `admin@sportcenter.com` account and its existing password. Do not request an additional Gym password, create a parallel credential store for SC users, or copy/hardcode the SC password. The existing frontend uses `sport_center_token` and `useGetMe`; all Gym routes must be protected by existing SC authenticated AdminLayout AND backend gym-specific RBAC, with short-lived server-to-server scoped delegation for calls to the independent Gym backend. Authentication is not permission: least-privilege authorization and tenant isolation are mandatory. Keep integration off in production until tests pass.
