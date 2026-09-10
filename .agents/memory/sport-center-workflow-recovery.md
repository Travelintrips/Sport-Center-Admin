---
name: Sport Center workflow recovery
description: Sport Center preview requires workspace dependency installation and one non-duplicate managed web workflow.
---

When the Sport Center workflow reports `vite: not found`, the workspace dependency links are missing; a frozen pnpm install restores them. Keep only one managed Sport Center web workflow because duplicate commands can compete for the same preview port.

A managed workflow can report `failed` while an orphaned process from an earlier attempt still serves its configured port. Stopping the workflow may leave an independently spawned duplicate alive, especially for the mockup sandbox. Confirm the configured ports are actually closed and terminate only the identified stale process group before restarting workflows one at a time.

**Why:** The artifact package can exist without its local node_modules after workflow/artifact changes, and duplicate or orphaned processes make a healthy server appear failed with `EADDRINUSE`.

**How to apply:** Restore dependencies only for `vite: not found`. For port conflicts, inspect process groups and port probes, clean stale owners, restart each managed workflow once, then verify both workflow state and application endpoints.