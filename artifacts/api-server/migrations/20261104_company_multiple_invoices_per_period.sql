-- Audit before applying; never modify paid invoice/payment rows.
-- Abort if existing invoice item links are duplicated across invoices.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sport_center.company_invoice_items
    WHERE booking_id IS NOT NULL
    GROUP BY booking_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate booking invoice links found; audit before migration';
  END IF;
END $$;

-- Enforce one invoice item per booking across all invoice numbers.
CREATE UNIQUE INDEX IF NOT EXISTS company_invoice_items_booking_unique
  ON sport_center.company_invoice_items (booking_id)
  WHERE booking_id IS NOT NULL;

-- Allow multiple invoices for the same company and period.
DROP INDEX IF EXISTS sport_center.company_invoices_company_period_unique;
