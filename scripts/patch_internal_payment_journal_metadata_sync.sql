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
         payment_provider = NEW.payment_provider::text,
         provider_name = NEW.provider_name,
         provider_id = NEW.provider_id,
         bank_account_id = NEW.bank_account_id,
         expected_settlement_date = NEW.expected_settlement_date,
         settlement_status = NEW.settlement_status,
         mdr_rate = NEW.mdr_rate,
         mdr_amount = NEW.mdr_amount,
         provider_reference = NEW.provider_reference,
         provider_order_id = NEW.provider_order_id,
         merchant_trade_no = NEW.merchant_trade_no,
         provider_trade_no = NEW.provider_trade_no,
         company_id = COALESCE(NEW.company_id, company_id)
   WHERE id = v_journal_id
     AND (
       payment_method IS DISTINCT FROM NEW.payment_method
       OR payment_provider IS DISTINCT FROM NEW.payment_provider::text
        OR provider_name IS DISTINCT FROM NEW.provider_name
        OR provider_id IS DISTINCT FROM NEW.provider_id
        OR bank_account_id IS DISTINCT FROM NEW.bank_account_id
        OR expected_settlement_date IS DISTINCT FROM NEW.expected_settlement_date
        OR settlement_status IS DISTINCT FROM NEW.settlement_status
        OR mdr_rate IS DISTINCT FROM NEW.mdr_rate
        OR mdr_amount IS DISTINCT FROM NEW.mdr_amount
        OR provider_reference IS DISTINCT FROM NEW.provider_reference
        OR provider_order_id IS DISTINCT FROM NEW.provider_order_id
        OR merchant_trade_no IS DISTINCT FROM NEW.merchant_trade_no
        OR provider_trade_no IS DISTINCT FROM NEW.provider_trade_no
        OR (NEW.company_id IS NOT NULL AND company_id IS DISTINCT FROM NEW.company_id)
     );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_payment_accounting_journal
  ON sport_center.sport_payments;
CREATE TRIGGER trg_sync_payment_accounting_journal
AFTER INSERT OR UPDATE OF payment_method, payment_provider, provider_name,
  provider_id, bank_account_id, expected_settlement_date, settlement_status,
  mdr_rate, mdr_amount, provider_reference, provider_order_id,
  merchant_trade_no, provider_trade_no, company_id
ON sport_center.sport_payments
FOR EACH ROW
EXECUTE FUNCTION sport_center.sync_payment_accounting_journal();