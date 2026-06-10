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
