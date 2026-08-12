---
name: Live accounting schema audit
description: The active Supabase public accounting schema is legacy-shaped and differs from newer audit helper assumptions.
---

The active Supabase environment may expose legacy `public.accounting_entries` and GL-line columns that do not match newer BizPortal audit helper projections. Read `information_schema` before writing diagnostic SQL, and use live column names rather than assuming the helper's shape.

**Why:** A read-only audit encountered missing-column errors in diagnostic-only queries even though the application was healthy; the live entries and GL data were still queryable after adapting to the actual schema.

**How to apply:** Treat helper-query failures as schema compatibility findings, not as evidence that accounting data is absent. Keep diagnostics read-only and verify entry linkage, GL balance, tax rows, and mirror rows with environment-specific columns.