---
name: Tracked configuration secrets
description: Security lesson about plaintext credentials stored in tracked Replit configuration files.
---

Tracked Replit configuration can contain plaintext credentials even when the runtime secret manager is configured correctly. Treat any real-looking secret in `.replit` or legacy tracked config as exposed: rotate it, remove it from the repository and history, and verify the replacement is scoped per environment.

**Why:** A repository audit found service-account private material, database credentials, API tokens, and application secrets embedded in tracked configuration. Environment-secret presence alone does not prove source/config isolation.

**How to apply:** Before staging or production readiness work, scan tracked config and fallback code paths for secret-shaped values. Never print the values in reports; report file and key names only.