---
name: Merge recovery validation
description: Validating external merges in this monorepo requires resolving source conflicts, syncing workspace dependencies, and regenerating API clients.
---

After an external merge, a clean Git conflict state is not sufficient: generated API clients and workspace-local dependencies may be out of sync with the merged server and frontend code.

**Why:** A prior merge left source markers, a missing locally-installed object-storage package, and stale generated hooks; the app could partially run while typecheck/build still failed.

**How to apply:** Resolve all unmerged files first, run the API client codegen, install dependencies from the owning workspace package, regenerate project-reference declarations with `pnpm run typecheck:libs`, then run frontend typecheck and API build before declaring the merge repaired.

After a dependency reset, API typecheck can report cascading TS6305 and implicit-any errors until workspace library declarations are regenerated with `pnpm run typecheck:libs`.

**Why:** The API package consumes declaration output from `lib/db` and related libraries; missing `dist/*.d.ts` files degrade type inference across unrelated routes, including reports.

**How to apply:** Run `pnpm install --frozen-lockfile` followed by `pnpm run typecheck:libs` before patching route annotations or classifying those errors as source regressions.