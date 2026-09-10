-- Sport Center production audit role
--
-- Run this file only as an authorized Supabase/PostgreSQL administrator
-- connected to the production database. It is intentionally a psql script:
-- the password must be supplied out-of-band through the environment variable
-- SUPABASE_PROD_AUDIT_ROLE_PASSWORD and is never stored in this file.
--
-- Example:
--   SUPABASE_PROD_AUDIT_ROLE_PASSWORD='provided-out-of-band' \
--     psql "$SUPABASE_DATABASE_URL" \
--     -v ON_ERROR_STOP=1 -f scripts/sql/production-audit-role.sql
--
-- Do not run this from the application pool or the audit runner.

\set ON_ERROR_STOP on
\getenv audit_role_password SUPABASE_PROD_AUDIT_ROLE_PASSWORD
\if :{?audit_role_password}
\else
  \echo 'SUPABASE_PROD_AUDIT_ROLE_PASSWORD is required out-of-band'
  \quit 3
\endif

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'sport_center_production_auditor'
  ) THEN
    EXECUTE 'CREATE ROLE sport_center_production_auditor LOGIN ' ||
      'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT ' ||
      'NOREPLICATION NOBYPASSRLS PASSWORD ' ||
      quote_literal(:'audit_role_password');
  ELSE
    RAISE EXCEPTION
      'role sport_center_production_auditor already exists; review it manually';
  END IF;
END
$$;

-- The database name is the standard Supabase PostgreSQL database.
-- CONNECT is granted explicitly; no database-wide ownership is granted.
GRANT CONNECT ON DATABASE postgres TO sport_center_production_auditor;

ALTER ROLE sport_center_production_auditor
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  NOREPLICATION NOBYPASSRLS;

GRANT USAGE ON SCHEMA sport_center TO sport_center_production_auditor;
GRANT USAGE ON SCHEMA public TO sport_center_production_auditor;

-- Explicit audit scope. Missing tables are skipped so this remains compatible
-- with deployments at different migration levels; no future-table privileges
-- or ownership are granted.
DO $$
DECLARE
  table_name text;
  audit_tables text[] := ARRAY[
    -- booking and lifecycle
    'sport_bookings', 'booking_history', 'booking_groups',
    'booking_extension_requests', 'booking_cancellations',
    'reschedule_requests', 'blocked_schedules', 'sport_facilities',
    'facility_images', 'users',
    -- payments and billing
    'sport_payments', 'payment_accounting_outbox',
    'payment_settlement_configs', 'paylabs_transactions',
    'company_billing_requirements', 'company_invoices',
    'company_invoice_items', 'corporate_booking_documentation',
    -- accounting, tax, settlement, reconciliation
    'accounting_journals', 'accounting_journal_lines', 'tax_settings',
    'tax_transactions', 'sport_expenses', 'coa_accounts',
    'bank_mutations', 'bank_account_balances', 'bank_journal_entries',
    'bank_reconciliation_matches', 'bank_reconciliation_account_rules',
    'bank_reconciliation_closing', 'qris_settlements',
    'qris_settlement_items',
    -- operational evidence
    'wa_action_tokens', 'wa_booking_sessions', 'wa_notif_logs',
    'wa_daily_usage_snapshots'
  ];
BEGIN
  FOREACH table_name IN ARRAY audit_tables LOOP
    IF to_regclass(format('sport_center.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT ON TABLE sport_center.%I TO sport_center_production_auditor',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

-- Public accounting is included because cross-entity verification must compare
-- the sport_center mirror with canonical public evidence.
DO $$
DECLARE
  table_name text;
  public_tables text[] := ARRAY[
    'companies', 'company_bank_accounts', 'accounting_entries',
    'accounting_entry_lines', 'accounting_journals', 'accounting_taxes',
    'chart_of_accounts', 'gl_tax_lines', 'sport_bookings', 'sport_payments'
  ];
BEGIN
  FOREACH table_name IN ARRAY public_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT ON TABLE public.%I TO sport_center_production_auditor',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

\unset audit_role_password
\echo 'Production audit role prepared with explicit SELECT-only grants.'