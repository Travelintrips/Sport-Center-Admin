-- New Sport Center payments must carry usable accounting metadata.
-- This is INSERT-only so existing historical rows remain untouched.
CREATE OR REPLACE FUNCTION sport_center.validate_new_payment_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'sport_center'
AS $function$
BEGIN
  IF NEW.company_id IS NULL OR NEW.company_id <= 0 THEN
    RAISE EXCEPTION
      'NEW_PAYMENT_COMPANY_ID_REQUIRED: payment metadata must include a valid company_id';
  END IF;

  IF NEW.provider_name IS NULL
     OR btrim(NEW.provider_name) = ''
     OR lower(btrim(NEW.provider_name)) = 'unknown' THEN
    RAISE EXCEPTION
      'NEW_PAYMENT_PROVIDER_NAME_REQUIRED: provider_name cannot be empty or unknown';
  END IF;

  IF NEW.bank_account_id IS NULL
     OR btrim(NEW.bank_account_id) = ''
     OR lower(btrim(NEW.bank_account_id)) = 'unknown' THEN
    RAISE EXCEPTION
      'NEW_PAYMENT_BANK_ACCOUNT_ID_REQUIRED: bank_account_id cannot be empty or unknown';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_new_payment_metadata
  ON sport_center.sport_payments;
CREATE TRIGGER trg_validate_new_payment_metadata
BEFORE INSERT ON sport_center.sport_payments
FOR EACH ROW
EXECUTE FUNCTION sport_center.validate_new_payment_metadata();