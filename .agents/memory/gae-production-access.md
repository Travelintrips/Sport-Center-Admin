---
name: GAE production access
description: The Sport Center custom domain runs on Google App Engine, separate from Replit deployment metadata and production database tooling.
---

The live Sport Center domain is served by Google App Engine in the `sc-sport-center` project. Replit deployment status, Replit production SQL, and Replit deployment logs do not represent this live environment. The Replit production SQL path may be unavailable entirely, and a bootstrap service account must have Secret Manager access before live Supabase data can be audited.

**Why:** The custom domain remained reachable while Replit reported no deployment and no production database; exact production failures therefore require Google Cloud Logging/GAE access.

**How to apply:** Use the GAE/Cloud Build path for releases and read-only Cloud Logging for incident diagnosis. For data audits, verify Secret Manager IAM first, then query the official `sport_center.sport_*` tables in the Supabase production project. Do not infer live production state from Replit deployment metadata or legacy table names.