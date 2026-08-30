-- Controlled metadata-only correction gate for posted Sport Center journals.
-- The gate is enabled only with SET LOCAL in an explicit correction transaction.
CREATE OR REPLACE FUNCTION sport_center.guard_posted_accounting_journal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'sport_center'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION
      'POSTED_ACCOUNTING_JOURNAL_CANNOT_BE_DELETED: %',
      OLD.id;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'posted' THEN
    IF COALESCE(
         current_setting(
           'sport_center.allow_posted_accounting_metadata_correction',
           true
         ),
         'off'
       ) = 'on' THEN
      IF (
        to_jsonb(NEW) - ARRAY[
          'payment_method',
          'payment_provider',
          'company_id',
          'bank_account_id'
        ]::text[]
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY[
          'payment_method',
          'payment_provider',
          'company_id',
          'bank_account_id'
        ]::text[]
      ) THEN
        RAISE EXCEPTION
          'POSTED_ACCOUNTING_JOURNAL_FINANCIAL_FIELDS_IMMUTABLE: %',
          OLD.id;
      END IF;
    ELSIF (
      to_jsonb(NEW) - ARRAY[
        'payment_method',
        'payment_provider'
      ]::text[]
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY[
        'payment_method',
        'payment_provider'
      ]::text[]
    ) THEN
      RAISE EXCEPTION
        'POSTED_ACCOUNTING_JOURNAL_FINANCIAL_FIELDS_IMMUTABLE: %',
        OLD.id;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'reversed' THEN
    RAISE EXCEPTION
      'REVERSED_ACCOUNTING_JOURNAL_IS_IMMUTABLE: %',
      OLD.id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;