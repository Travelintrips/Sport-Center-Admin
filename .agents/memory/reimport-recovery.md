---
name: Re-import recovery for Sport Center project
description: What to do when this project reappears as a fresh "imported project" setup task despite already being fully built.
---

This repo (Sport Center Jakarta booking app) is a mature, previously-built project, not a fresh import. It has a `github.com/Travelintrips/Sport-Center-Admin` remote and a `gitsafe-backup` remote. When a "set up the imported project" task shows up again (e.g. after a GitHub re-import or `.replit` corruption/rollback), don't treat it as an unknown codebase:

- `replit.md` already documents run commands, stack, architecture, and gotchas in full — read it first instead of re-deriving from scratch.
- Dev Supabase credentials and `SESSION_SECRET` are already present as environment secrets; no new secrets are needed to get it running.
- Artifacts and their workflows are auto-detected/recreated from `.replit-artifact` markers, so a plain `pnpm install` + workflow restart is normally sufficient — no migrations or DB fixes needed.
- If an artifact workflow reports a package missing even though its manifest and lockfile already contain it, use `pnpm install --filter <workspace> --frozen-lockfile`; offline install may fail when the package tarball is not cached.
- In a workspace with a root-package guard, the managed package installer may target the root and fail; use the repo's frozen-lockfile install to restore all workspace links without changing manifests.
- Admin login can be smoke-tested via the demo credentials already documented in `replit.md`'s Product section — don't duplicate those credentials elsewhere.

**Why:** Re-imports/rollbacks can make the task system re-run generic "imported project" onboarding on a project that already has an established identity; skipping straight to verification (instead of asking generic discovery questions) matches user expectations and avoids redundant work.
