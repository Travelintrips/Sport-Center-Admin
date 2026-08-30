---
name: Secret bootstrap write boundary
description: Runtime Secret Manager credentials are read-oriented and configuration repair requires separate explicit authorization.
---

Treat the runtime bootstrap credential as a Secret Manager reader. Never assume successful secret access also permits creating a replacement version.

**Why:** Production diagnosis may prove a stored configuration value is stale while the bootstrap identity still correctly lacks `secretmanager.versions.add`. Broadening runtime permissions just to repair configuration weakens least privilege.

**How to apply:** Validate candidate values without printing them, obtain explicit approval before any external secret mutation, and require a separately authorized path with `roles/secretmanager.secretVersionAdder` when a new version is genuinely needed. Do not add fallback behavior that bypasses the shared secret.