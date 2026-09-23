---
name: GSM-loaded test environment
description: Why managed API startup and shell-launched tests see different development configuration.
---

Managed API workflows bootstrap development Supabase configuration from the shared Google Secret Manager payload before importing the application. The bootstrap can itself succeed while the workflow still fails if the payload has no development database pair; standalone shell test commands also fail without the same bootstrap.

**Why:** The application intentionally loads secrets at runtime to keep environment separation and fail closed; exporting unrelated production values into test commands would risk testing against the wrong database.

**How to apply:** Verify that the bootstrap loaded the development database pair before restarting the API workflow. Keep pure unit tests independent of database-importing modules, and never work around a missing dev URL by pointing tests at production.

Shell Jest can also fail before collecting tests when the ESM setup file with top-level await is loaded through the default Jest configuration. Pure validation suites can be isolated with setupFiles disabled, but DB-backed suites still require a correctly bootstrapped test runner.

**Why:** A setup/runtime failure is unrelated to the payment implementation, while direct pure-module regression tests remain runnable.

**How to apply:** Separate configuration/bootstrap failures from feature failures in audit reports; do not treat zero collected tests as a payment regression result.

For this API package, database-importing integration tests require the Secret Manager bootstrap in Jest `setupFiles`, not only `setupFilesAfterEnv`; the latter runs after `@workspace/db` has already validated its top-level environment.

**Why:** Loading the development URL in a lifecycle hook is too late when test modules import the database package during collection.

**How to apply:** Keep the bootstrap module side-effect-only with top-level await, set `GCP_PROJECT_ID`/`GCP_SECRET_ID` for shell runs, and never substitute production credentials.