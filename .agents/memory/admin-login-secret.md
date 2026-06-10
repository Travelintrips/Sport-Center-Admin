---
name: Admin login & SESSION_SECRET
description: Why admin login fails with "Invalid credentials" despite correct password, and how to fix per-DB.
---

# Admin login depends on SESSION_SECRET per database

Passwords are HMAC-SHA256(password, SESSION_SECRET) — there is no salt, so the stored
hash is only valid for the exact SESSION_SECRET that produced it.

**Symptom:** login returns 401 `Invalid credentials` even with the correct
`admin@sportcenter.com` / `admin123`.

**Cause:** the admin row's `password_hash` was seeded with a *different* SESSION_SECRET
than the server is currently running with. Dev and prod use **separate Supabase
databases** (`SUPABASE_DATABASE_URL_DEV` vs `SUPABASE_DATABASE_URL`), each with its own
independently-seeded admin row — one can be broken while the other works.

**Why:** the runtime SESSION_SECRET (dev value lives in `artifacts/api-server/.env.local`)
is an 88-char base64 string, not the default `sport-center-secret-key-2024`. Any seed
made with the default (or an older secret) will never match.

**How to fix:** recompute `HMAC-SHA256("admin123", <that server's SESSION_SECRET>)` and
`UPDATE sport_center.users SET password_hash = ... WHERE email = 'admin@sportcenter.com'`
on the affected DB. Connect with `pg` over the pooler URL from `.env.local` (dev) using
`ssl:{rejectUnauthorized:false}`. `scripts/src/seed-admin.ts` does the same upsert but
relies on the db-client URL precedence (`SUPABASE_DATABASE_URL || ... || _DEV`), so be
sure the right URL wins or it will fix the wrong DB.
