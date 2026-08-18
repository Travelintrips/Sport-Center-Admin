---
name: GAE production access
description: The Sport Center custom domain runs on Google App Engine, separate from Replit deployment metadata and production database tooling.
---

The live Sport Center domain is served by Google App Engine in the `sc-sport-center` project. Replit deployment status, Replit production SQL, and Replit deployment logs do not represent this live environment.

**Why:** The custom domain remained reachable while Replit reported no deployment and no production database; exact production failures therefore require Google Cloud Logging/GAE access.

**How to apply:** Use the GAE/Cloud Build path for releases and read-only Cloud Logging for incident diagnosis. Do not infer live production state from Replit deployment metadata.