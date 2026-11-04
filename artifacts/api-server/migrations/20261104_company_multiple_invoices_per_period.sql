-- Audit before applying; never modify paid invoice/payment rows.
-- Abort if existing invoice item links are duplicated across invoices.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sport_center.company_invoices
    GROUP BY company_customer_id, period_month HAVING count(*) > 2
  ) THEN
    RAISE EXCEPTION 'More than two invoices already exist in a company/month; audit before migration';
  END IF;
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

-- Serialize invoice creation per company/month and enforce the limit at the database
-- boundary, including simultaneous requests and callers other than the admin UI.
CREATE OR REPLACE FUNCTION sport_center.enforce_company_invoice_period_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  existing_count integer;
BEGIN
  -- Serialize concurrent invoice inserts for the same company and period.
  PERFORM pg_advisory_xact_lock(
    hashtext(NEW.company_customer_id::text),
    hashtext(NEW.period_month::text)
  );

  SELECT count(*) INTO existing_count
  FROM sport_center.company_invoices
  WHERE company_customer_id = NEW.company_customer_id
    AND period_month = NEW.period_month
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF existing_count >= 2 THEN
    RAISE EXCEPTION 'Maximum 2 invoices per company per month'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS company_invoice_period_limit_guard
  ON sport_center.company_invoices;
CREATE TRIGGER company_invoice_period_limit_guard
BEFORE INSERT OR UPDATE OF company_customer_id, period_month
ON sport_center.company_invoices
FOR EACH ROW EXECUTE FUNCTION sport_center.enforce_company_invoice_period_limit();
