# Production Access Remediation

## 1. Current blocker

Production-data audit is **BLOCKED**. The active workspace does not have a verified production database connection or production-owner IAM evidence. Development must not be used as a substitute.

## 2. Required GCP project

The App Engine deployment must run in the production Google Cloud project configured for Sport Center. The exact project identifier must be confirmed by the production owner or by read-only Cloud metadata; it is intentionally not duplicated here.

## 3. Required runtime identity

Use the App Engine runtime service account for the production service. Do not use a user key file or commit service-account JSON. The runtime identity must be confirmed in the deployment project.

## 4. Required Secret Manager access

Grant only `roles/secretmanager.secretAccessor`, scoped to the specific production secrets required by the application. Do not grant Owner, Editor, Secret Manager Admin, or broad project access merely to complete an audit.

## 5. Required secret metadata

The deployment must define the documented production secret IDs for the database URL, Supabase URL/keys, session secret, and feature credentials. Secret values must remain in Secret Manager and must never be copied into source, `.replit`, build YAML, logs, fixtures, or this document.

## 6. Required IAM permission

The runtime identity needs `secretmanager.versions.access` through the least-privilege accessor role. If read-only inspection cannot prove this permission, record the exact denied resource and permission for the production owner; do not force an IAM change from this workspace.

## 7. Verification steps

1. Confirm the project and runtime identity through read-only GCP metadata.
2. Confirm each required secret exists and has an accessible latest version without printing payloads.
3. Confirm the application bootstrap loads production secrets from Secret Manager.
4. Confirm startup fails when the project, accessor permission, or required secret is missing.
5. Confirm production has no development-only URL/key variables.
6. Confirm frontend bundles and API responses contain no service-role credential.

## 8. Production DB read-only audit process

After owner authorization, use a read-only production connection, verify the target project and `sport_center` schema, run only approved SELECT/information-schema probes, save masked results, and keep the production-data report separate from this code-level remediation. Never use the development database as evidence for production.

## 9. Secret rotation checklist

Use `PRODUCTION_SECRET_ROTATION_REQUIRED.md`. Rotate at the owning provider, publish the new Secret Manager versions, verify runtime access, re-publish, revoke old credentials, and review provider audit logs. No rotation is performed automatically from this workspace.