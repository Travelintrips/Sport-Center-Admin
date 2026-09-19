---
name: API test bootstrap
description: Jest's default API setup depends on ESM secret bootstrap before database imports.
---

Jest tests that import the API database layer need the development Supabase environment bootstrapped before module evaluation; the repository's default setup file uses top-level await and direct ad-hoc Jest runs may load it as CommonJS.

**Why:** Running a targeted test with the default config can fail before test discovery with `await is not defined`, which can be mistaken for a regression in the tested code.

**How to apply:** Prefer the managed test/bootstrap path when available. For isolated pure API tests, use a test config that explicitly treats TypeScript as ESM and disables the external bootstrap only when the test supplies safe non-production database placeholders.