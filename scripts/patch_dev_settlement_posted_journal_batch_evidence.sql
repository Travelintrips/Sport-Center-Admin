-- DEV-first canonical settlement state hardening (must follow snapshot migration).
-- Preserve immutable posted payment journals. The canonical sport_payments row
-- owns current settlement_status; the posted journal is a historical snapshot.
-- Only an isolated "unsettled" -> "settled" payment-state transition may avoid
-- a retroactive journal metadata UPDATE. All other metadata changes retain the
-- existing posted journal immutability guard and fail closed on conflicts.
-- Apply only after DEV verification; never auto-apply to production.
CREATE OR REPLACE FUNCTION sport_center.sync_payment_accounting_journal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'sport_center', 'public'
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

  IF v_count = 0 THEN RETURN NEW; END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION
      'PAYMENT_ACCOUNTING_JOURNAL_AMBIGUOUS: payment_id=% journal_count=%',
      NEW.id, v_count USING ERRCODE = 'P0001';
  END IF;

  SELECT status::text INTO v_journal_status
    FROM sport_center.accounting_journals WHERE id = v_journal_id;

  IF v_journal_status = 'reversed' THEN RETURN NEW; END IF;

  -- A posted journal must never be rewritten merely because canonical payment
  -- state advanced during settlement finalization. Require the entire source
  -- payment to be unchanged except for the monotonic settlement transition and
  -- updated_at. If any other field changes, keep the normal safety guard.
  IF v_journal_status = 'posted' AND TG_OP = 'UPDATE' THEN
    IF OLD.settlement_status = 'unsettled'
       AND NEW.settlement_status = 'settled'
       -- Only the canonical owner is allowed to advance the payment. A bare
       -- UPDATE to settled must not bypass a posted journal's guard.
       AND EXISTS (
         SELECT 1
           FROM sport_center.payment_settlement_items item
           JOIN sport_center.payment_settlement_batches batch
             ON batch.id = item.settlement_id
           JOIN sport_center.accounting_journals settlement_journal
             ON settlement_journal.id = batch.settlement_journal_id
          WHERE item.payment_id = NEW.id
            AND item.item_status = 'active'
            AND batch.status IN ('posted', 'reconciled')
            AND batch.company_id = NEW.company_id
            AND batch.bank_account_id = NEW.bank_account_id
            AND batch.settlement_date::text = NEW.expected_settlement_date
            AND lower(batch.provider_code) = lower(NEW.payment_provider::text)
            AND batch.settlement_rule_version = NEW.settlement_rule_version
            AND settlement_journal.status = 'posted'
            AND settlement_journal.journal_type = 'settlement'
            AND settlement_journal.is_reversal = false
       )
       AND (to_jsonb(NEW) - ARRAY['settlement_status','updated_at']::text[])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['settlement_status','updated_at']::text[])
    THEN
      RETURN NEW;
    END IF;
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
