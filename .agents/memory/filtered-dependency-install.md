---
name: Filtered dependency install
description: Recover runtime dependencies when a full workspace install is blocked by a Replit package firewall.
---

When the full workspace install is blocked fetching the API codegen package, install the dependency closure for the API and web artifacts with the existing lockfile filters instead of changing package versions.

**Why:** The codegen package is not needed to run or validate the API and web artifacts, but a full workspace install still tries to fetch it and can fail before creating usable node_modules.

**How to apply:** Use the workspace's frozen lockfile with filters for `@workspace/api-server...` and `@workspace/sport-center...`; include the codegen workspace only when regenerating API clients.