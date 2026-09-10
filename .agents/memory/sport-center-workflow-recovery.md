---
name: Sport Center workflow recovery
description: Sport Center preview requires workspace dependency installation and one non-duplicate managed web workflow.
---

When the Sport Center workflow reports `vite: not found`, the workspace dependency links are missing; a frozen pnpm install restores them. Keep only one managed Sport Center web workflow because duplicate commands can compete for the same preview port.

**Why:** The artifact package can exist without its local node_modules after workflow/artifact changes, and duplicate web workflows make a healthy Vite server appear unavailable.

**How to apply:** Run the workspace frozen install, restart `artifacts/sport-center: web`, and inspect the actual managed port from workflow status rather than assuming port 5000.