---
name: Vite optimizer cache after dependency reinstall
description: Recovery for stale Vite optimized dependency paths after a workspace pnpm reinstall
---

After a workspace dependency reinstall, if Vite reports that an existing package's optimized `dist/index.mjs` cannot be opened, remove the affected artifact's generated `node_modules/.vite` cache and restart its workflow.

**Why:** pnpm can legitimately change the peer-suffix path behind a symlink while Vite's dependency optimizer still references the previous absolute path, leaving the preview with a false missing-module error.

**How to apply:** Treat this as generated-cache recovery, not a source or dependency-version change. Rebuild/restart the affected artifact and verify the preview before investigating application code.