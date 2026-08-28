---
name: Production runtime identity
description: Always verify the live deployment identity before diagnosing the Sport Center custom domain; tracked GAE files are not evidence of the live runtime.
---

Deployment identity must be checked with the current Replit deployment metadata before each production incident. The metadata can change; the latest check reported no active deployment for this workspace even though `https://sc.travelintrips.co.id` remains reachable, so that domain may be serving an older or separately managed build. The tracked `gae-deploy/app.yaml` and `cloudbuild.yaml` are not evidence of the live runtime unless new deployment evidence proves otherwise. Production still loads its Supabase configuration through the shared Google Secret Manager bootstrap.

**Why:** A stale assumption about the custom-domain attachment can make local fixes and logs appear correct while the user-facing production site runs a different build.

**How to apply:** Start runtime audits with fresh Replit deployment metadata and deployment logs. If no active deployment is reported, do not assume the reachable custom domain is this workspace; confirm its ownership/build before treating local changes as production changes. Treat GAE files as legacy configuration. For transaction audits, verify a separate safe read-only connection to the production Supabase database before querying; do not use the application's write-capable pool.