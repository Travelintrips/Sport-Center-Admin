---
name: GSM-loaded test environment
description: Why managed API startup and shell-launched tests see different development configuration.
---

Managed API workflows bootstrap development Supabase configuration from the shared Google Secret Manager payload before importing the application. Standalone shell test commands do not run that bootstrap and can fail while importing the database package if the dev database URL is absent.

**Why:** The application intentionally loads secrets at runtime to keep environment separation and fail closed; exporting unrelated production values into test commands would risk testing against the wrong database.

**How to apply:** Keep pure unit tests independent of database-importing modules. Use the managed workflow or an approved development-only secret bootstrap for integration tests, and never work around this by pointing tests at production.