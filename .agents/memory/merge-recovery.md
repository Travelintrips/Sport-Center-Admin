---
name: Merge recovery validation
description: Validating external merges in this monorepo requires resolving source conflicts, syncing workspace dependencies, and regenerating API clients.
---

After an external merge, a clean Git conflict state is not sufficient: generated API clients and workspace-local dependencies may be out of sync with the merged server and frontend code.

**Why:** A prior merge left source markers, a missing locally-installed object-storage package, and stale generated hooks; the app could partially run while typecheck/build still failed.

**How to apply:** Resolve all unmerged files first, run the API client codegen, install dependencies from the owning workspace package, then run frontend typecheck and API build before declaring the merge repaired.