---
name: Production secret bootstrap
description: Production startup must load secrets before importing database/application modules.
---

Production uses a dedicated bootstrap entrypoint that loads Google Secret Manager values before dynamically importing the API. It deletes pre-existing production secret env values and exits when Secret Manager or required secrets are unavailable.

**Why:** Static ESM imports initialize the database pool before top-level code in the old entrypoint, allowing stale environment values to bypass the intended source of truth.

**How to apply:** Keep deployment and package entrypoints pointed at the bootstrap artifact; never restore direct startup through the application entrypoint or add a production database fallback.