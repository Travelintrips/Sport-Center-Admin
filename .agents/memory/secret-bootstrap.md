---
name: Production secret bootstrap
description: Production startup must load secrets before importing database/application modules.
---

Production uses a dedicated bootstrap entrypoint that loads Google Secret Manager values before dynamically importing the API. Development uses its explicitly scoped bootstrap credential/project/secret identifiers for the DEV database URL. Both paths fail closed when their required source is unavailable.

**Why:** Static ESM imports initialize the database pool before top-level code in the old entrypoint, allowing stale environment values to bypass the intended source of truth.

**How to apply:** Keep deployment and package entrypoints pointed at the bootstrap artifact; never restore direct startup through the application entrypoint or add a production database fallback. Never make DEV read production identifiers or use DATABASE_URL as a substitute.