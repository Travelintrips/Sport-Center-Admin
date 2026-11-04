-- Run after reviewing existing company invoices; does not update any invoice or payment rows.
-- Multiple invoices may share a company and billing month.
DROP INDEX IF EXISTS sport_center.company_invoices_company_period_unique;
-- Prevent a booking from appearing on two different invoice item rows.
-- Existing duplicates must be audited and resolved before applying this index.
CREATE UNIQUE INDEX IF NOT EXISTS company_invoice_items_booking_unique
  ON sport_center.company_invoice_items (booking_id)
  WHERE booking_id IS NOT NULL;
