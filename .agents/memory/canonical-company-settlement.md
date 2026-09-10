---
name: Canonical company settlement source
description: Settlement ownership must resolve companies from the Supabase public company master.
---

The payment settlement configuration must use active rows from `public.companies`, because facility ownership mappings and company bank accounts reference those IDs. The Sport Center user/customer table is a separate identity model and can have different IDs.

**Why:** Using `sport_center.users` caused the settlement dropdown to omit the canonical company referenced by SC-0002 and made it possible to register an account against the wrong company.

**How to apply:** When listing or validating settlement companies, query active `public.companies` and use the same company ID for `facility_company_mappings`, `company_bank_accounts`, and settlement rules.