---
name: COA Accounts feature
description: Chart of Accounts dropdown in Tambah Pengeluaran; journal pattern determined by COA account type.
---

## Rule
Expenses are linked to `coa_accounts` table via `sport_expenses.coa_account_id` (nullable FK). The COA account's `account_type` determines the double-entry journal pattern:
- `expense` → Debit Beban, Kredit Kas/Bank (operational)
- `asset` → Debit Piutang/Aset (kasbon), Kredit Kas/Bank
- `liability` → Debit Hutang/Kewajiban, Kredit Kas/Bank

**Why:** Replacing flat category dropdown with proper COA selector enables correct automated journal posting per accounting standards.

**How to apply:**
- `detectJournalType(accountType)` in `artifacts/api-server/src/lib/accounting.ts`
- `GET /admin/expenses/coa-accounts` endpoint filters accountType IN (asset, liability, expense)
- Frontend groups COA by type with visual journal-pattern hint
- Seed: 30 COA accounts seeded in migration script (codes 1101-6199)
- drizzle-kit push fails on Supabase shared DB; apply via raw pg node script with `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`
