-- Manual/e-wallet payments use provider_code = unknown. They are valid
-- confirmed receipts, but have no owner-approved processor settlement rule.
-- Do not fabricate one: mirror them as manual-review/unsettled entries.
CREATE OR REPLACE FUNCTION sport_center.mirror_confirmed_payment_to_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'sport_center', 'public'
AS $function$
DECLARE
  v_canonical_metadata RECORD;
  v_public_booking_id integer;
  v_public_booking_count integer;
  v_booking_tax_rate numeric;
  v_facility_id integer;
  v_company_id integer;
  v_company_count integer;
  v_external_bank_account_id text;
  v_internal_bank_account_id integer;
  v_bank_account_count integer;
  v_provider_id text;
  v_provider_name text;
  v_provider_code text;
  v_provider_rule_version text;
  v_settlement_delay integer;
  v_payment_date date;
  v_expected_settlement_date date;
  v_business_day boolean;
  v_remaining integer;
  v_payment_number text;
  v_source jsonb;
  v_source_status text;
BEGIN
  -- The resolver updates canonical metadata inside this trigger. Do not
  -- re-enter the projection on that internal update.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  v_source := to_jsonb(NEW);
  v_source_status := COALESCE(v_source->>'status', '');

  IF NEW.status::text <> 'confirmed' THEN
    -- A non-confirmed source state after posting needs an explicit accounting
    -- reversal/reconciliation flow. This projection must not mutate a paid,
    -- posted mirror by itself.
    IF EXISTS (
      SELECT 1
      FROM public.sport_payments existing
      WHERE existing.payment_number = 'SCPAY-SC-' || NEW.id::text
        AND existing.posting_status NOT IN ('unposted', 'failed')
    ) THEN
      RAISE EXCEPTION 'POSTED_ACCOUNTING_JOURNAL_SOURCE_STATE_CONFLICT: canonical payment % cannot update a posted public payment outside the reversal flow',
        NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.sport_payments
       SET amount = COALESCE(NULLIF(v_source->>'amount', '')::numeric, amount),
           method = COALESCE(NULLIF(v_source->>'payment_method', ''), method),
           status = CASE
             WHEN v_source_status IN ('cancelled', 'canceled') THEN 'cancelled'
             WHEN v_source_status = 'refunded' THEN 'refunded'
             WHEN v_source_status <> '' THEN v_source_status
             ELSE status
           END,
           paid_at = COALESCE(
             NULLIF(v_source->>'confirmed_at', '')::timestamptz,
             NULLIF(v_source->>'paid_at', '')::timestamptz,
             paid_at
           ),
           payment_type = COALESCE(NULLIF(v_source->>'payment_type', ''), payment_type),
           updated_at = now()
     WHERE payment_number = 'SCPAY-SC-' || NEW.id::text;
    RETURN NEW;
  END IF;

  v_payment_number := 'SCPAY-SC-' || NEW.id::text;
  v_provider_code := NULLIF(LOWER(BTRIM(NEW.payment_provider::text)), '');

  -- A legacy booking can have no public projection yet. Serialize projection
  -- creation by canonical booking id so concurrent confirmations cannot create
  -- duplicate bridges.
  PERFORM pg_advisory_xact_lock(917053, NEW.booking_id);

  SELECT COUNT(*)::integer, MIN(pb.id)
    INTO v_public_booking_count, v_public_booking_id
    FROM public.sport_bookings pb
   WHERE pb.sc_booking_id = NEW.booking_id;

  IF v_public_booking_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_BOOKING_BRIDGE_AMBIGUOUS: canonical booking % has % public bridges',
      NEW.booking_id, v_public_booking_count
      USING ERRCODE = 'P0001';
  END IF;

  SELECT sb.facility_id, sb.ppn_rate
    INTO v_facility_id, v_booking_tax_rate
    FROM sport_center.sport_bookings sb
   WHERE sb.id = NEW.booking_id;

  IF NOT FOUND OR v_facility_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: canonical booking % has no facility',
      NEW.booking_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer, MIN(fcm.company_id)
    INTO v_company_count, v_company_id
    FROM sport_center.facility_company_mappings fcm
   WHERE fcm.facility_id = v_facility_id
     AND fcm.is_active = TRUE
     AND fcm.approval_status = 'OWNER_APPROVED';

  IF v_company_count = 0 OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: facility % has no active company mapping',
      v_facility_id
      USING ERRCODE = 'P0001';
  ELSIF v_company_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: facility % has % active company mappings',
      v_facility_id, v_company_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Older Sport Center bookings can predate the public accounting projection.
  -- Build the missing one only after the source booking and its owner-approved
  -- company mapping have both been validated.
  IF v_public_booking_count = 0 THEN
    INSERT INTO public.sport_bookings
      (company_id, booking_number, customer_name, customer_phone, facility_name,
       booking_date, start_time, end_time, duration_hours, status, payment_status,
       base_amount, discount_amount, total_amount, tax_rate, tax_amount,
       notes, created_at, updated_at, sc_booking_id)
    SELECT
      v_company_id,
      sb.order_number,
      sb.customer_name,
      sb.customer_phone,
      COALESCE(f.name, 'Sport Center'),
      sb.booking_date::date,
      sb.start_time::time,
      sb.end_time::time,
      COALESCE(sb.duration_hours, 1),
      'confirmed',
      'paid',
      GREATEST(0, COALESCE(sb.total_price, 0) - COALESCE(sb.ppn_amount, 0)),
      COALESCE(sb.discount_amount, 0),
      COALESCE(sb.total_price, 0),
      COALESCE(sb.ppn_rate, 0),
      COALESCE(sb.ppn_amount, 0),
      COALESCE(sb.notes, ''),
      sb.created_at,
      now(),
      sb.id
    FROM sport_center.sport_bookings sb
    LEFT JOIN sport_center.facilities f ON f.id = sb.facility_id
    WHERE sb.id = NEW.booking_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.sport_bookings existing
        WHERE existing.sc_booking_id = NEW.booking_id
      )
    RETURNING id INTO v_public_booking_id;

    IF v_public_booking_id IS NULL THEN
      SELECT MIN(pb.id)
        INTO v_public_booking_id
        FROM public.sport_bookings pb
       WHERE pb.sc_booking_id = NEW.booking_id;
    END IF;
    IF v_public_booking_id IS NULL THEN
      RAISE EXCEPTION 'MIRROR_BOOKING_BRIDGE_MISSING: canonical booking % could not be projected', NEW.booking_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- A manual receipt (e.g. Transfer Bank, DANA, cash) is confirmed by an
  -- administrator, not by a gateway settlement. Preserve it in the public
  -- source projection without inventing a bank-account mapping, MDR, or
  -- expected settlement date. Known providers below remain fail-closed.
  IF v_provider_code IS NULL OR v_provider_code = 'unknown' THEN
    v_provider_id := COALESCE(
      NULLIF(BTRIM(NEW.provider_id::text), ''),
      'manual-' || NEW.id::text
    );
    v_provider_name := COALESCE(
      NULLIF(BTRIM(NEW.provider_name::text), ''),
      NULLIF(BTRIM(NEW.payment_method::text), ''),
      'manual'
    );
    v_provider_code := 'unknown';

    -- A posted public payment has already produced an immutable journal. A
    -- source row that now claims a different manual method is a reconciliation
    -- problem, not a value the confirmation path may rewrite silently.
    IF EXISTS (
      SELECT 1
      FROM public.sport_payments existing
      WHERE existing.payment_number = v_payment_number
        AND existing.posting_status NOT IN ('unposted', 'failed')
        AND (
          existing.amount IS DISTINCT FROM NEW.amount
          OR existing.method IS DISTINCT FROM COALESCE(NEW.payment_method, 'Transfer Bank')
          OR existing.booking_id IS DISTINCT FROM v_public_booking_id
          OR existing.company_id IS DISTINCT FROM v_company_id
          OR existing.provider_id IS DISTINCT FROM v_provider_id
          OR existing.payment_provider IS DISTINCT FROM v_provider_name
          OR LOWER(COALESCE(existing.provider_code, '')) IS DISTINCT FROM 'unknown'
          OR existing.bank_account_id IS NOT NULL
          OR existing.external_bank_account_id IS NOT NULL
          OR existing.expected_settlement_date IS NOT NULL
          OR existing.settlement_rule_version IS NOT NULL
          OR existing.status IS DISTINCT FROM 'paid'
          OR existing.paid_at IS DISTINCT FROM COALESCE(NEW.confirmed_at, NEW.created_at)
          OR existing.payment_type IS DISTINCT FROM COALESCE(NEW.payment_type::text, 'full_payment')
          OR existing.tax_rate IS DISTINCT FROM COALESCE(v_booking_tax_rate, 0)
          OR existing.tax_amount IS DISTINCT FROM 0
          OR existing.settlement_status IS DISTINCT FROM COALESCE(NULLIF(BTRIM(NEW.settlement_status::text), ''), 'unsettled')
          OR existing.source_schema IS DISTINCT FROM 'sport_center'
          OR existing.source_table IS DISTINCT FROM 'sport_payments'
          OR existing.source_payment_id IS DISTINCT FROM NEW.id
        )
    ) THEN
      RAISE EXCEPTION 'POSTED_ACCOUNTING_JOURNAL_PAYMENT_METADATA_CONFLICT: canonical payment % conflicts with an immutable posted public payment',
        NEW.id
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.sport_payments
      (booking_id, payment_number, amount, method, status, paid_at,
       payment_type, tax_rate, tax_amount, source, posting_status,
       company_id, provider_id, payment_provider, provider_code,
       bank_account_id, external_bank_account_id,
       expected_settlement_date, settlement_rule_version, settlement_status,
       source_schema, source_table, source_payment_id,
       created_at, updated_at)
    VALUES
      (v_public_booking_id,
       v_payment_number,
       NEW.amount,
       COALESCE(NEW.payment_method, 'Transfer Bank'),
       'paid',
       COALESCE(NEW.confirmed_at, NEW.created_at),
       COALESCE(NEW.payment_type::text, 'full_payment'),
       COALESCE(v_booking_tax_rate, 0),
       0,
       'SPORT_CENTER_SUPABASE',
       'unposted',
       v_company_id,
       v_provider_id,
       v_provider_name,
       v_provider_code,
       NULL,
       NULL,
       NULL,
       NULL,
       COALESCE(NULLIF(BTRIM(NEW.settlement_status::text), ''), 'unsettled'),
       'sport_center',
       'sport_payments',
       NEW.id,
       NEW.created_at,
       now())
    ON CONFLICT (payment_number) DO UPDATE
      SET booking_id = COALESCE(public.sport_payments.booking_id, EXCLUDED.booking_id),
          company_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.company_id ELSE public.sport_payments.company_id END,
          provider_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.provider_id ELSE public.sport_payments.provider_id END,
          payment_provider = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.payment_provider ELSE public.sport_payments.payment_provider END,
          provider_code = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.provider_code ELSE public.sport_payments.provider_code END,
          bank_account_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN NULL ELSE public.sport_payments.bank_account_id END,
          external_bank_account_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN NULL ELSE public.sport_payments.external_bank_account_id END,
          expected_settlement_date = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN NULL ELSE public.sport_payments.expected_settlement_date END,
          settlement_rule_version = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN NULL ELSE public.sport_payments.settlement_rule_version END,
          settlement_status = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.settlement_status ELSE public.sport_payments.settlement_status END,
          source_schema = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.source_schema ELSE public.sport_payments.source_schema END,
          source_table = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.source_table ELSE public.sport_payments.source_table END,
          source_payment_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.source_payment_id ELSE public.sport_payments.source_payment_id END,
          amount = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.amount ELSE public.sport_payments.amount END,
          method = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.method ELSE public.sport_payments.method END,
          paid_at = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.paid_at ELSE public.sport_payments.paid_at END,
          payment_type = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.payment_type ELSE public.sport_payments.payment_type END,
          tax_rate = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.tax_rate ELSE public.sport_payments.tax_rate END,
          tax_amount = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.tax_amount ELSE public.sport_payments.tax_amount END,
          updated_at = now();
    RETURN NEW;
  END IF;

  -- Known processors (QRIS/Paylabs) must resolve against an owner-approved
  -- settlement rule before the public payment projection is written.
  SELECT *
    INTO v_canonical_metadata
    FROM sport_center.resolve_and_persist_payment_metadata(NEW.id);

  v_external_bank_account_id := NULLIF(BTRIM(NEW.bank_account_id::text), '');
  IF v_external_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: canonical payment % has no external bank account',
      NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer, MIN(cba.id)
    INTO v_bank_account_count, v_internal_bank_account_id
    FROM public.company_bank_accounts cba
   WHERE cba.company_id = v_company_id
     AND cba.account_number::text = v_external_bank_account_id
     AND cba.is_active = TRUE;

  IF v_bank_account_count = 0 OR v_internal_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: company % has no active bank account %',
      v_company_id, v_external_bank_account_id
      USING ERRCODE = 'P0001';
  ELSIF v_bank_account_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: company % has % active matches for bank account %',
      v_company_id, v_bank_account_count, v_external_bank_account_id
      USING ERRCODE = 'P0001';
  END IF;

  v_provider_id := NULLIF(BTRIM(NEW.provider_id::text), '');
  v_provider_name := NULLIF(BTRIM(NEW.provider_name::text), '');
  IF v_provider_id IS NULL OR v_provider_name IS NULL THEN
    RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: canonical payment % has incomplete provider identity',
      NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  v_payment_date := (COALESCE(NEW.paid_at, NEW.confirmed_at, NEW.created_at)
    AT TIME ZONE 'Asia/Jakarta')::date;

  SELECT COUNT(*)::integer, MIN(psc.rule_version), MIN(psc.settlement_delay_business_days)
    INTO v_company_count, v_provider_rule_version, v_settlement_delay
    FROM sport_center.payment_settlement_configs psc
   WHERE psc.company_id = v_company_id
     AND LOWER(BTRIM(psc.provider_code)) = v_provider_code
     AND psc.bank_account_id = v_external_bank_account_id
     AND psc.is_active = TRUE
     AND psc.source = 'OWNER_APPROVED'
     AND psc.rule_version = 'PROD-MANDIRI-SC-20260810-v1'
     AND psc.effective_from <= v_payment_date
     AND (psc.effective_until IS NULL OR v_payment_date < psc.effective_until);

  IF v_company_count = 0 OR v_provider_rule_version IS NULL OR v_settlement_delay IS NULL THEN
    RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: no owner-approved rule for company %, provider %, bank %',
      v_company_id, v_provider_code, v_external_bank_account_id
      USING ERRCODE = 'P0001';
  ELSIF v_company_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: multiple owner-approved rules for company %, provider %, bank %',
      v_company_id, v_provider_code, v_external_bank_account_id
      USING ERRCODE = 'P0001';
  END IF;

  v_expected_settlement_date := v_payment_date;
  v_remaining := GREATEST(v_settlement_delay, 0);
  WHILE v_remaining > 0 LOOP
    v_expected_settlement_date := v_expected_settlement_date + 1;
    SELECT COALESCE(pbc.is_business_day, TRUE)
      INTO v_business_day
      FROM sport_center.payment_business_calendar pbc
     WHERE pbc.calendar_date = v_expected_settlement_date;
    IF EXTRACT(ISODOW FROM v_expected_settlement_date) < 6
       AND COALESCE(v_business_day, TRUE) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;

  LOOP
    SELECT COALESCE(pbc.is_business_day, TRUE)
      INTO v_business_day
      FROM sport_center.payment_business_calendar pbc
     WHERE pbc.calendar_date = v_expected_settlement_date;
    EXIT WHEN EXTRACT(ISODOW FROM v_expected_settlement_date) < 6
      AND COALESCE(v_business_day, TRUE);
    v_expected_settlement_date := v_expected_settlement_date + 1;
  END LOOP;

  INSERT INTO public.sport_payments
    (booking_id, payment_number, amount, method, status, paid_at,
     payment_type, tax_rate, tax_amount, source, posting_status,
     company_id, provider_id, payment_provider, provider_code,
     bank_account_id, external_bank_account_id,
     expected_settlement_date, settlement_rule_version, settlement_status,
     source_schema, source_table, source_payment_id,
     created_at, updated_at)
  VALUES
    (v_public_booking_id,
     v_payment_number,
     NEW.amount,
     COALESCE(NEW.payment_method, 'Transfer Bank'),
     'paid',
     COALESCE(NEW.confirmed_at, NEW.created_at),
     COALESCE(NEW.payment_type::text, 'full_payment'),
     COALESCE(v_booking_tax_rate, 0),
     0,
     'SPORT_CENTER_SUPABASE',
     'unposted',
     v_company_id,
     v_provider_id,
     v_provider_name,
     v_provider_code,
     v_internal_bank_account_id,
     v_external_bank_account_id,
     v_expected_settlement_date::text,
     v_provider_rule_version,
     COALESCE(NULLIF(BTRIM(NEW.settlement_status::text), ''), 'unsettled'),
     'sport_center',
     'sport_payments',
     NEW.id,
     NEW.created_at,
     now())
  ON CONFLICT (payment_number) DO UPDATE
    SET booking_id = COALESCE(public.sport_payments.booking_id, EXCLUDED.booking_id),
        company_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.company_id ELSE public.sport_payments.company_id END,
        provider_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.provider_id ELSE public.sport_payments.provider_id END,
        payment_provider = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.payment_provider ELSE public.sport_payments.payment_provider END,
        provider_code = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.provider_code ELSE public.sport_payments.provider_code END,
        bank_account_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.bank_account_id ELSE public.sport_payments.bank_account_id END,
        external_bank_account_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.external_bank_account_id ELSE public.sport_payments.external_bank_account_id END,
        expected_settlement_date = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.expected_settlement_date ELSE public.sport_payments.expected_settlement_date END,
        settlement_rule_version = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.settlement_rule_version ELSE public.sport_payments.settlement_rule_version END,
        settlement_status = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.settlement_status ELSE public.sport_payments.settlement_status END,
        source_schema = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.source_schema ELSE public.sport_payments.source_schema END,
        source_table = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.source_table ELSE public.sport_payments.source_table END,
        source_payment_id = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.source_payment_id ELSE public.sport_payments.source_payment_id END,
        amount = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.amount ELSE public.sport_payments.amount END,
        method = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.method ELSE public.sport_payments.method END,
        paid_at = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.paid_at ELSE public.sport_payments.paid_at END,
        payment_type = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.payment_type ELSE public.sport_payments.payment_type END,
        tax_rate = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.tax_rate ELSE public.sport_payments.tax_rate END,
        tax_amount = CASE WHEN public.sport_payments.posting_status IN ('unposted', 'failed') THEN EXCLUDED.tax_amount ELSE public.sport_payments.tax_amount END,
        updated_at = now();

  RETURN NEW;
END;
$function$;

-- Existing deployments already have this trigger. Create it when recovering
-- an older database, and replace an incorrectly wired trigger with the
-- canonical projection function above.
DO $trigger$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'sport_center'
      AND r.relname = 'sport_payments'
      AND t.tgname = 'trg_mirror_confirmed_payment_to_public'
      AND NOT t.tgisinternal
      AND (
        p.proname <> 'mirror_confirmed_payment_to_public'
        OR t.tgenabled NOT IN ('O', 'A')
        OR (t.tgtype & 1) = 0
        OR (t.tgtype & 2) <> 0
        OR (t.tgtype & 4) = 0
        OR (t.tgtype & 16) = 0
      )
  ) THEN
    EXECUTE 'DROP TRIGGER trg_mirror_confirmed_payment_to_public ON sport_center.sport_payments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'sport_center'
      AND r.relname = 'sport_payments'
      AND t.tgname = 'trg_mirror_confirmed_payment_to_public'
      AND NOT t.tgisinternal
      AND p.proname = 'mirror_confirmed_payment_to_public'
      AND t.tgenabled IN ('O', 'A')
      AND (t.tgtype & 1) <> 0
      AND (t.tgtype & 2) = 0
      AND (t.tgtype & 4) <> 0
      AND (t.tgtype & 16) <> 0
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_mirror_confirmed_payment_to_public AFTER INSERT OR UPDATE ON sport_center.sport_payments FOR EACH ROW EXECUTE FUNCTION sport_center.mirror_confirmed_payment_to_public()';
  END IF;
END
$trigger$;

DO $verify$
BEGIN
  IF to_regprocedure('sport_center.resolve_and_persist_payment_metadata(integer)') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_MIRROR_DEPENDENCY_MISSING: resolve_and_persist_payment_metadata(integer)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'sport_center'
      AND r.relname = 'sport_payments'
      AND t.tgname = 'trg_mirror_confirmed_payment_to_public'
      AND NOT t.tgisinternal
      AND p.proname = 'mirror_confirmed_payment_to_public'
      AND t.tgenabled IN ('O', 'A')
      AND (t.tgtype & 1) <> 0
      AND (t.tgtype & 2) = 0
      AND (t.tgtype & 4) <> 0
      AND (t.tgtype & 16) <> 0
  ) THEN
    RAISE EXCEPTION 'PAYMENT_MIRROR_TRIGGER_MISSING';
  END IF;
END
$verify$;