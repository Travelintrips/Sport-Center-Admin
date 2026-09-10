-- Keep the public accounting entry header aligned with a Sport Center payment
-- metadata correction. This intentionally updates only classification fields:
-- journal amounts, tax, lines, dates, settlement facts, and posting status are
-- immutable and are never touched here.
CREATE OR REPLACE FUNCTION public.sync_sport_payment_entry_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_entry_status text;
BEGIN
  -- An upsert from the canonical Sport Center payment can include method and
  -- payment_provider in its SET list even when their values did not change.
  -- PostgreSQL still fires an UPDATE OF trigger in that case. A payment-date
  -- correction before bank matching must not be blocked by classification
  -- accounting checks that are unrelated to paid_at.
  IF TG_OP = 'UPDATE'
     AND NEW.method IS NOT DISTINCT FROM OLD.method
     AND NEW.payment_provider IS NOT DISTINCT FROM OLD.payment_provider THEN
    RETURN NEW;
  END IF;

  -- A mirror can exist before the central entry is posted. There is no header
  -- to synchronize until entry_id has been assigned.
  IF NEW.entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ae.status::text
    INTO v_entry_status
    FROM public.accounting_entries ae
   WHERE ae.id = NEW.entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PUBLIC_PAYMENT_ACCOUNTING_ENTRY_MISSING: payment=% entry_id=%',
      NEW.id,
      NEW.entry_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_entry_status = 'reversed' THEN
    RAISE EXCEPTION
      'REVERSED_PUBLIC_ACCOUNTING_ENTRY_IS_IMMUTABLE: entry_id=%',
      NEW.entry_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.accounting_entries
     SET payment_method = NEW.method,
         payment_provider = NEW.payment_provider
   WHERE id = NEW.entry_id
     AND (
       payment_method IS DISTINCT FROM NEW.method
       OR payment_provider IS DISTINCT FROM NEW.payment_provider
     );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_sport_payment_entry_metadata
  ON public.sport_payments;
CREATE TRIGGER trg_sync_sport_payment_entry_metadata
AFTER INSERT OR UPDATE OF method, payment_provider
ON public.sport_payments
FOR EACH ROW
EXECUTE FUNCTION public.sync_sport_payment_entry_metadata();