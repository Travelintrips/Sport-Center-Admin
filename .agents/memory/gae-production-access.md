---
name: Production runtime identity
description: The current Sport Center custom domain is attached to the active Replit Autoscale deployment; tracked GAE files are not evidence of the live runtime.
---

The current Replit deployment metadata reports `https://sc.travelintrips.co.id` as the primary URL and `https://sport-center-27917.replit.app` as an additional URL, with an active public Autoscale deployment and successful build. The tracked `gae-deploy/app.yaml` and `cloudbuild.yaml` describe a separate legacy/unused GAE path unless new deployment evidence proves otherwise. Production still loads its Supabase configuration through the shared Google Secret Manager bootstrap.

**Why:** Current deployment tooling directly associates the custom domain with Replit, so old GAE assumptions would send incident investigation to the wrong runtime.

**How to apply:** Start runtime audits with Replit deployment metadata and deployment logs. Treat GAE files as legacy configuration. For transaction audits, verify a separate safe read-only connection to the production Supabase database before querying; do not use the application's write-capable pool.