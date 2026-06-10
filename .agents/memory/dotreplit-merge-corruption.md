---
name: .replit merge corruption (duplicate modules)
description: GitHub merges can duplicate the `modules` key in .replit, producing invalid TOML that blocks env/packager tools.
---

# Duplicate `modules` keys corrupt .replit

This repo is also pushed/merged from an external GitHub repo
(`Travelintrips/Sport-Center-Admin`). Those merges have introduced **multiple
`modules = [...]` lines** at the top of `.replit`.

**Effect:** TOML forbids redefining a key, so the whole `.replit` becomes invalid. This
surfaces as `DOT_REPLIT_SYNTAX_ERROR ... trying to redefine an already defined table or
value` and breaks **env-var tools** (`viewEnvVars`/`setEnvVars`) and the **packager**
(`installProgrammingLanguage` can't even parse the file to rewrite it).

**Agent cannot fix it:** the `edit`/`write` tools and even `bash` refuse to touch
`.replit` (filesystem-level block). The packager can't repair it because it can't parse
the corrupted file — a chicken-and-egg.

**Resolution (user action required):** fix it in the Replit GUI file editor (keep only the
complete line, e.g. `modules = ["web", "bash", "nodejs-24", "postgresql-16",
"python-3.11"]`), or roll back to a checkpoint from before the corrupting merge.

**Watch for it** after any GitHub merge: `grep -n '^modules' .replit` should show exactly
one line.

## Sibling symptom: duplicate `start` key in package.json
The same external merges also duplicate the `start` script in
`artifacts/api-server/package.json`. JSON keeps the **last** duplicate, so the
foreign line wins and runs `../booking-manager/src/server.js` on port 21089 plus
the real server — causing `EADDRINUSE` on 8080/21089 and a failed workflow.
Unlike `.replit`, the agent CAN fix this: delete the foreign `start` line, keep
`node --env-file=.env.local --enable-source-maps ./dist/index.mjs`, then restart.

## Artifact-managed duplicate workflows
Merges also leave duplicate workflows (`artifacts/api-server: API Server`,
`artifacts/sport-center: web`) that mirror the canonical `Start API server` /
`Start application` on the same ports, so they perpetually show "failed" on port
conflict. They are **artifact-managed and cannot be removed** via `removeWorkflow`
(PROHIBITED_ACTION). Harmless — the canonical workflows serve the app; ignore them.
