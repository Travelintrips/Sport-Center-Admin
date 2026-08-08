---
name: UAT QRIS fixture integrity
description: Data-integrity constraints discovered while running the QRIS reconciliation dry-run.
---

UAT QRIS fixtures must populate `uat_marker` consistently on the materialized payment and bank-mutation rows, and the Friday/weekend mutation date must agree with the business-calendar expected settlement date.

**Why:** A dry-run scoped only by the marker columns falsely reported zero payments and mutations even though the staged batch contained the complete fixture; the Friday case also exposed a one-day expected-versus-actual mismatch.

**How to apply:** Before future UAT evaluation, verify marker-column counts against the import batch row count and validate every fixture's expected settlement date against its mutation date. If materialization is inconsistent, use a read-only marker/reference fallback only for diagnosis and report the fixture issue rather than mutating it.