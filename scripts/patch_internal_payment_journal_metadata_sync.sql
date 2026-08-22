-- Synchronize a Sport Center payment classification to its internal accounting
-- journal. This is deliberately metadata-only: financial values and journal
-- lifecycle fields remain protected by guard_posted_accounting_journal().
CREATE OR REPLACE FUNCTION sport_center.sync_payment_accounting_journal()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_journal_id integer;
  v_journal_status text;
  v_count integer;
BEGIN
  SELECT COUNT(*), MIN(id)
    INTO v_count, v_journal_id
    FROM sport_center.accounting_journals
   WHERE payment_id = NEW.id
     AND journal_type = 'payment_confirmed'
     AND is_reversal = false;

  IF v_count = 0 THEN
    RETURN NEW;
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'PAYMENT_ACCOUNTING_JOURNAL_AMBIGUOUS: payment_id=% journal_count=%',
      NEW.id,
      v_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT status::text
    INTO v_journal_status
    FROM sport_center.accounting_journals
   WHERE id = v_journal_id;

  IF v_journal_status = 'reversed' THEN
    RETURN NEW;
  END IF;

  UPDATE sport_center.accounting_journals
     SET payment_method = NEW.payment_method,
         payment_provider = NEW.payment_provider::text
   WHERE id = v_journal_id
     AND (
       payment_method IS DISTINCT FROM NEW.payment_method
       OR payment_provider IS DISTINCT FROM NEW.payment_provider::text
     );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_payment_accounting_journal
  ON sport_center.sport_payments;
CREATE TRIGGER trg_sync_payment_accounting_journal
AFTER INSERT OR UPDATE OF payment_method, payment_provider
ON sport_center.sport_payments
FOR EACH ROW
EXECUTE FUNCTION sport_center.sync_payment_accounting_journal();