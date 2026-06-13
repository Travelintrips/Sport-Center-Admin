---
name: Bank Recon Hardening
description: 6-phase hardening for bank reconciliation production readiness — period lock, balance ledger, company isolation, exception dashboard, audit
---

## Phase 1 — AP/Invoice Settlement
- `settleInvoice()` in bankReconciliation.ts handles partial/full invoice settlement on approval
- `propagateApproval()` triggers settleInvoice for payment and order candidate types
- Invoice status transitions: unpaid → partial_paid → paid based on paidAmount vs grandTotal

## Phase 2 — Period Lock
- `isPeriodLocked(transactionDate, bankAccountId)` checks `bank_reconciliation_closing` for `status='closed'`
- Returns HTTP 423 (Locked) if period is closed
- Applied to: approve, reject, delete (returns lockedSkipped count), mark-unmatched, mark-duplicate, post-journal, tax-fields
- Only superAdminMiddleware can reopen a closed period

## Phase 3 — Bank Balance Ledger
- New table `bank_account_balances` (bank_account_id, company_id, opening_balance, current_balance, last_reconciled_balance)
- Unique constraint on (bank_account_id, company_id) for upsert
- `updateBankBalance()` called fire-and-forget after approve and approve-candidate
- GET /bank-reconciliation/balances endpoint

## Phase 4 — Multi Company Isolation
- Added `company_id` to `bank_mutations` and `bank_journal_entries`
- `postAccountingJournal()` saves company_id from mutation into journal entry
- Currently single-company so nullable; infrastructure ready for multi-tenant

## Phase 5 — Exception Dashboard
- GET /bank-reconciliation/exception-dashboard → KPI stats + exception lists
- Frontend: ExceptionDashboardTab (default tab) with KPI cards + exception list + bank balance table + Final Audit section

## Phase 6 — Final Audit
- GET /bank-reconciliation/audit runs 7 checks: duplicate journals, missing approvedBy, invoice overpaid, closed period with difference != 0, closed period unposted, no company_id (info), unposted journals
- Returns { summary: { critical, warning, info, productionReady }, findings[] }

## Schema Changes (migration: scripts/migrate-bank-production.ts)
- CREATE TABLE sport_center.bank_account_balances
- ALTER TABLE bank_mutations ADD COLUMN company_id
- ALTER TABLE bank_journal_entries ADD COLUMN company_id

**Why:** Period lock prevents data integrity violations after period close; balance ledger gives real-time running balance; audit endpoint gives ops team a one-click production readiness check.
