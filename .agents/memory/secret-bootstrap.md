---
name: Production secret bootstrap
description: Production startup must load secrets before importing database/application modules.
---

Production uses a dedicated bootstrap entrypoint that loads Google Secret Manager values before dynamically importing the API. Development uses its explicitly scoped bootstrap credential/project/secret identifiers for the DEV database URL. Both paths fail closed when their required source is unavailable.

**Why:** Static ESM imports initialize the database pool before top-level code in the old entrypoint, allowing stale environment values to bypass the intended source of truth.

Replit Autoscale does not provide Google Cloud's `GOOGLE_CLOUD_PROJECT` metadata variable. The project identifier must therefore be supplied explicitly when this bootstrap runs outside GCP, and the bootstrap service account needs `secretmanager.versions.access` on the shared secret.

**Why:** Without an explicit project ID the process exits before binding its port; with an authenticated but unauthorized service account, Secret Manager returns 403 and startup still fails closed.

**How to apply:** Keep deployment and package entrypoints pointed at the bootstrap artifact; never restore direct startup through the application entrypoint or add a production database fallback. Never make DEV read production identifiers or use DATABASE_URL as a substitute. For Replit runtime checks, verify both the explicit project/secret IDs and the service account's secret-level `roles/secretmanager.secretAccessor` grant.