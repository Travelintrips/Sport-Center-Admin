# Sport Center — Production Read-Only Audit Setup

Status: **PREPARED / PRODUCTION ACCESS BLOCKED UNTIL ADMIN PROVISIONS THE ROLE**

This setup prepares the safe boundary for the production record-level audit. It
does not create a production role, access Secret Manager, run an audit query,
retry outbox work, approve reconciliation candidates, or mutate any production
data.

## 1. Dedicated PostgreSQL role

Role name:

`sport_center_production_auditor`

The administrator must execute `scripts/sql/production-audit-role.sql` while
connected to the production Supabase PostgreSQL database. The script requires
the role password through the out-of-band environment variable
`SUPABASE_PROD_AUDIT_ROLE_PASSWORD`; it does not contain a real password.

The role is explicitly:

- `LOGIN`
- `NOSUPERUSER`
- `NOCREATEDB`
- `NOCREATEROLE`
- `NOINHERIT`
- `NOREPLICATION`
- `NOBYPASSRLS`

It receives only `CONNECT`, schema `USAGE`, and explicit `SELECT` grants for
the audit tables. The script does not grant ownership, `REFERENCES`, `TRIGGER`,
`CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`.

Missing tables at an older migration level are skipped and must be documented
by the administrator. No default privileges are granted, so future tables
require an explicit review and grant.

## 2. Secret Manager secret

Required secret:

`SUPABASE_PROD_AUDIT_DATABASE_URL`

The secret must contain only the dedicated connection string for
`sport_center_production_auditor`. It must not contain the application
production URL, development URL, service-role key, or any other credential.

The authorized production administrator must create and grant access to this
secret through the existing Google Secret Manager process. The value must
never be committed, printed, placed in `.replit`, or copied into
`SUPABASE_DATABASE_URL`.

Required runtime mapping:

`SUPABASE_PROD_AUDIT_DATABASE_URL` → latest version of
`SUPABASE_PROD_AUDIT_DATABASE_URL`

This is intentionally a separate runner secret, not an application resolver
fallback. The application continues to use its existing production resolver.

## 3. Runner environment

Run only the dedicated runner with:

```text
NODE_ENV=production-audit
SUPABASE_PROD_AUDIT_DATABASE_URL=<injected-by-secret-manager>
```

The runner is:

```text
scripts/audit/production-read-only-runner.ts
```

It refuses to start unless `NODE_ENV` is exactly `production-audit`. It loads
only `SUPABASE_PROD_AUDIT_DATABASE_URL`, rejects development-looking URLs,
rejects equality with application or development database variables, and
rejects any role other than `sport_center_production_auditor`.

## 4. Read-only verification

The runner immediately starts a transaction, sets it read-only, and verifies:

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SHOW transaction_read_only;
SELECT current_user;
SELECT current_database();
ROLLBACK;
```

The expected transaction mode is `on`, and the expected database role is
`sport_center_production_auditor`. If either check fails, the runner stops.
Every session ends with `ROLLBACK`, including error paths.

## 5. SQL statement guard

Every audit statement passes through a guard that permits only a single
`SELECT` or read-only `WITH` statement. It rejects mutation, DDL, privilege,
transaction-control, and maintenance keywords, including:

`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `ALTER`, `CREATE`, `DROP`, `TRUNCATE`,
`GRANT`, `REVOKE`, `CALL`, `DO`, `COPY`, `VACUUM`, and `REFRESH`.

This guard is defense-in-depth. PostgreSQL role privileges and the read-only
transaction are the primary controls.

## 6. Audit scope

The prepared scope covers booking lifecycle, payments, payment accounting
outbox, corporate billing and invoices, recurring/group/reschedule evidence,
check-in evidence, expenses, invoice/tax, QRIS and settlement, bank
reconciliation, WhatsApp evidence, public accounting mirrors, duplicate
journals, debit/credit, and cross-entity integrity.

The runner's initial phase only verifies the connection and discovers table
availability. Record-level classification must run only after the dedicated
role and secret are provisioned and the read-only gate passes.

## 7. Rollback and prohibited operations

No historical remediation is part of this runner. It must not:

- create payment rows or invoices;
- update booking, payment, outbox, reconciliation, tax, or accounting status;
- retry or requeue outbox work;
- approve reconciliation candidates;
- post or repair Central Finance entries;
- migrate schema or grant future privileges.

The audit session is rolled back at completion. The administrator must review
the explicit grant list before provisioning and must separately control secret
rotation and revocation.

## 8. External boundary

The following actions cannot be performed from the current workspace without
authorized production administration:

1. Create `sport_center_production_auditor` in the production Supabase
   database.
2. Set its password out-of-band.
3. Grant the explicit table scope.
4. Create and inject `SUPABASE_PROD_AUDIT_DATABASE_URL` from Secret Manager.
5. Grant the runner identity access to that secret.

Until those actions are complete:

```text
PRODUCTION READ-ONLY AUDIT INFRASTRUCTURE = PREPARED
PRODUCTION READ-ONLY ACCESS = BLOCKED
PRODUCTION TRANSACTION AUDIT = BLOCKED
PRODUCTION DATA MUTATION = NONE
```