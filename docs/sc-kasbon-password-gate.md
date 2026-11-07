# Kasbon Edit/Hapus — one dedicated authorization password

This protection is separate from the normal Sport Center user role and login.

## Configuration (production server only)
Set these **secret environment variables on the API server**, not in GitHub,
the frontend, browser local storage, ChatGPT, AI Core, OpenClaw, or a test screenshot.

- `SC_KASBON_ACTION_PASSWORD_HASH` — bcrypt hash of one strong randomly
  selected password (at least 12 characters; recommended 20+).
- `SC_KASBON_ACTION_SIGNING_KEY` — independently generated cryptographically
  random hex key, at least 32 bytes / 64 hex characters.

Generate both **locally on an authorized administrative machine**. Do not paste
the password or signing key into AI chat, git, an issue, a screenshot, or logs.
Verify the application refuses access when either value is missing.

A backend deploy without these values intentionally keeps **Edit and Hapus
locked**. The person operating the Hostinger environment is responsible for
setting and rotating the secrets using an approved password manager and
restricting their access. Prevent automated agents and connectors from viewing
or editing those environment variables. A privileged server administrator
who can change the running process environment is outside the guarantee of
application-level role enforcement.

## Behavior
- Admin authentication is still mandatory for viewing the protected record.
- A dedicated password verification is required for each chosen Kasbon record.
- Five incorrect attempts lock further attempts for 15 minutes *per backend
  process*. Apply upstream IP/account rate limiting across replicas in
  multi-instance deployments.
- On success an HMAC-signed authorization expires in 90 seconds. It binds the
  specific authenticated account, employee ID, and Kasbon record ID.
- PATCH and DELETE fail with HTTP 403 without the grant. Passwords are never
  embedded in the grant nor written to audit logs.
- No special role (including owner and super_admin) bypasses this guard.
- Creating a new Kasbon, syncing Kasbon POOL, and viewing/checking/syncing
  payroll totals remain unchanged.
- Audit events `SC_KASBON_ACTION_UNLOCKED` and
  `SC_KASBON_ACTION_UNLOCK_DENIED` omit secrets.

## Verification checklist
1. Without configured secrets, unlock returns 503. PATCH/DELETE always return 403.
2. Incorrect password returns 403/429 without exposing expected hash.
3. Correct password reveals Edit/Hapus only for selected record.
4. Using the authorization on another employee/record/account returns 403.
5. Expired or tampered grant returns 403; higher role without password returns 403.
6. Edit and Delete still use existing validation/audit logging.
7. Test against DEV first with a temporary unrelated secret. No real data deletion
   or production password testing is necessary for frontend review.
