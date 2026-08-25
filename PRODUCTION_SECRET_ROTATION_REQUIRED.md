# Production Secret Rotation Required

Status: **HIGH / CRITICAL — owner action required**

## Secret types

- Supabase production database connection URL
- Supabase production service-role key
- Production session/auth secret
- Google service-account JSON/private key
- Payment, messaging, SMTP, AI, and other API credentials present in the historical repository/configuration

## Affected locations

- Historical Git commits and the tracked Replit configuration
- Historical deployment/build configuration and attached audit artifacts

## Exposure evidence

The repository audit found credential-shaped values in the current tracked configuration and historical Git content. Values are intentionally not reproduced here. Production data access was not performed because a verified production database connection was unavailable.

## Why rotation is required

Removing values from the current tree does not revoke credentials reachable from Git history, caches, logs, or external systems. Treat every production credential found by the audit as potentially compromised until revoked and replaced by the system owner.

## Systems potentially affected

- Supabase production project and database
- Google Cloud Secret Manager and App Engine runtime identity
- Replit environment configuration
- Payment provider, WhatsApp, SMTP, Google, AI, and object-storage integrations

## Exact rotation sequence

1. Freeze production writes only if required by the system owner’s incident process; do not use this workspace to modify production data.
2. Inventory each affected secret by name and owning system, without copying values into tickets or chat.
3. Create replacement values in the owning provider.
4. Update Google Secret Manager versions using the production owner’s approved access path.
5. Revoke the old Supabase database credential/service-role key and all other affected provider credentials.
6. Verify App Engine runtime identity can access only the required secret versions.
7. Re-publish production so runtime configuration is refreshed.
8. Revoke any old Replit bootstrap/access values that were not strictly required.
9. Review provider audit logs for unauthorized use during the exposure window.

## Verification checklist

- [ ] No secret values remain in the current Git tree.
- [ ] Secret Manager contains the replacement versions.
- [ ] Runtime uses the expected production project and database.
- [ ] App Engine starts only when required secrets load successfully.
- [ ] Service-role credentials are absent from frontend bundles and responses.
- [ ] Provider audit logs show no unexplained access.
- [ ] Production data audit is performed separately by an authorized owner.