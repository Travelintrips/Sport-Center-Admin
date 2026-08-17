CREATE OR REPLACE FUNCTION sport_center.mirror_confirmed_payment_to_public()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_canonical_metadata RECORD;
  v_public_booking_id integer; v_public_booking_count integer;
  v_booking_tax_rate numeric; v_facility_id integer;
  v_company_id integer; v_company_count integer;
  v_external_bank_account_id text; v_internal_bank_account_id integer; v_bank_account_count integer;
  v_provider_id text; v_provider_name text; v_provider_code text;
  v_provider_rule_version text; v_settlement_delay integer;
  v_payment_date date; v_expected_settlement_date date;
  v_business_day boolean; v_remaining integer; v_payment_number text;
  v_src_booking sport_center.sport_bookings%ROWTYPE;
  v_facility_name text;
  v_base_amount numeric;
  v_ppn_amount numeric;
BEGIN
  IF NEW.status::text <> 'confirmed' THEN RETURN NEW; END IF;
  v_payment_number := 'SCPAY-SC-' || NEW.id::text;
  SELECT * INTO v_canonical_metadata FROM sport_center.resolve_and_persist_payment_metadata(NEW.id);

  -- ── Provider code extraction (needed early for unknown short-circuit) ──────
  v_provider_code := NULLIF(LOWER(BTRIM(NEW.payment_provider::text)), '');

  -- ── Auto-create public bridge if missing ──────────────────────────────────
  SELECT COUNT(*)::integer, MIN(pb.id)
    INTO v_public_booking_count, v_public_booking_id
    FROM public.sport_bookings pb WHERE pb.sc_booking_id = NEW.booking_id;

  IF v_public_booking_count = 0 THEN
    SELECT * INTO v_src_booking FROM sport_center.sport_bookings WHERE id = NEW.booking_id;
    SELECT f.name INTO v_facility_name FROM sport_center.facilities f WHERE f.id = v_src_booking.facility_id;
    SELECT MIN(fcm.company_id) INTO v_company_id
      FROM sport_center.facility_company_mappings fcm
     WHERE fcm.facility_id = v_src_booking.facility_id
       AND fcm.is_active = TRUE AND fcm.approval_status = 'OWNER_APPROVED';
    v_ppn_amount  := COALESCE(v_src_booking.ppn_amount, 0);
    v_base_amount := GREATEST(0, COALESCE(v_src_booking.total_price, 0) - v_ppn_amount);

    INSERT INTO public.sport_bookings
      (company_id, booking_number, customer_name, customer_phone, facility_name,
       booking_date, start_time, end_time, duration_hours, status, payment_status,
       base_amount, discount_amount, total_amount, tax_rate, tax_amount,
       notes, created_at, updated_at, sc_booking_id)
    SELECT
      COALESCE(v_company_id, 1),
       v_src_booking.order_number,
       v_src_booking.customer_name,
       v_src_booking.customer_phone,
       COALESCE(v_facility_name, 'Sport Center'),
       v_src_booking.booking_date::date,
       v_src_booking.start_time::time,
       v_src_booking.end_time::time,
       COALESCE(v_src_booking.duration_hours, 1),
       'confirmed', 'paid',
       v_base_amount,
       COALESCE(v_src_booking.discount_amount, 0),
       COALESCE(v_src_booking.total_price, 0),
       COALESCE(v_src_booking.ppn_rate, 0),
       v_ppn_amount,
       COALESCE(v_src_booking.notes, ''),
       v_src_booking.created_at, NOW(),
       NEW.booking_id
    WHERE NOT EXISTS (SELECT 1 FROM public.sport_bookings WHERE sc_booking_id = NEW.booking_id)
    RETURNING id INTO v_public_booking_id;

    IF v_public_booking_id IS NULL THEN
      SELECT id INTO v_public_booking_id FROM public.sport_bookings WHERE sc_booking_id = NEW.booking_id LIMIT 1;
    END IF;
    v_public_booking_count := 1;
  ELSIF v_public_booking_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_BOOKING_BRIDGE_AMBIGUOUS: canonical booking % has % public bridges',
      NEW.booking_id, v_public_booking_count;
  END IF;

  -- ── Facility / company resolution ─────────────────────────────────────────
  SELECT sb.facility_id, sb.ppn_rate INTO v_facility_id, v_booking_tax_rate
    FROM sport_center.sport_bookings sb WHERE sb.id = NEW.booking_id;
  IF NOT FOUND OR v_facility_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: canonical booking % has no facility', NEW.booking_id;
  END IF;
  SELECT COUNT(*)::integer, MIN(fcm.company_id) INTO v_company_count, v_company_id
    FROM sport_center.facility_company_mappings fcm
   WHERE fcm.facility_id = v_facility_id AND fcm.is_active = TRUE AND fcm.approval_status = 'OWNER_APPROVED';
  IF v_company_count = 0 OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: facility % has no active company mapping', v_facility_id;
  ELSIF v_company_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_COMPANY_UNRESOLVED: facility % has % active company mappings', v_facility_id, v_company_count;
  END IF;

  -- ── Unknown provider short-circuit ───────────────────────────────────────
  -- Transfer Bank payments with unresolved provider skip bank-account lookup
  -- and settlement-rule resolution; they still get a public.sport_payments row.
  IF v_provider_code = 'unknown' OR v_provider_code IS NULL THEN
    v_provider_id           := COALESCE(NULLIF(BTRIM(NEW.provider_id::text), ''), 'manual-' || NEW.id::text);
    v_provider_name         := COALESCE(NULLIF(BTRIM(NEW.provider_name::text), ''), 'Transfer Bank');
    v_provider_code         := COALESCE(v_provider_code, 'unknown');
    v_provider_rule_version := NULL;
    v_expected_settlement_date := NULL;
    v_internal_bank_account_id := NULL;
    v_external_bank_account_id := NULL;

    INSERT INTO public.sport_payments
      (booking_id, payment_number, amount, method, status, paid_at, payment_type, tax_rate, tax_amount,
       source, posting_status, company_id, provider_id, payment_provider, provider_code,
       bank_account_id, external_bank_account_id, expected_settlement_date, settlement_rule_version,
       settlement_status, source_schema, source_table, source_payment_id, created_at, updated_at)
    VALUES
      (v_public_booking_id, v_payment_number, NEW.amount,
       COALESCE(NEW.payment_method, 'Transfer Bank'),
       'paid', COALESCE(NEW.confirmed_at, NEW.created_at),
       COALESCE(NEW.payment_type::text, 'full_payment'),
       COALESCE(v_booking_tax_rate, 0), 0,
       'SPORT_CENTER_SUPABASE', 'unposted',
       v_company_id, v_provider_id, v_provider_name, v_provider_code,
       NULL, NULL, NULL, NULL,
       COALESCE(NULLIF(BTRIM(NEW.settlement_status::text), ''), 'unsettled'),
       'sport_center', 'sport_payments', NEW.id,
       NEW.created_at, now())
    ON CONFLICT (payment_number) DO UPDATE
      SET booking_id     = COALESCE(public.sport_payments.booking_id, EXCLUDED.booking_id),
          company_id     = EXCLUDED.company_id,
          updated_at     = now();
    RETURN NEW;
  END IF;

  -- ── Full resolution for known providers (QRIS, etc.) ─────────────────────
  v_external_bank_account_id := NULLIF(BTRIM(NEW.bank_account_id::text), '');
  IF v_external_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: canonical payment % has no external bank account', NEW.id;
  END IF;
  SELECT COUNT(*)::integer, MIN(cba.id) INTO v_bank_account_count, v_internal_bank_account_id
    FROM public.company_bank_accounts cba
   WHERE cba.company_id = v_company_id
     AND cba.account_number::text = v_external_bank_account_id
     AND cba.is_active = TRUE;
  IF v_bank_account_count = 0 OR v_internal_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: company % has no active bank account %', v_company_id, v_external_bank_account_id;
  ELSIF v_bank_account_count > 1 THEN
    RAISE EXCEPTION 'MIRROR_BANK_ACCOUNT_UNRESOLVED: company % has % active matches for bank account %', v_company_id, v_bank_account_count, v_external_bank_account_id;
  END IF;
  v_provider_id   := NULLIF(BTRIM(NEW.provider_id::text), '');
  v_provider_name := NULLIF(BTRIM(NEW.provider_name::text), '');
  IF v_provider_id IS NULL OR v_provider_name IS NULL THEN
    RAISE EXCEPTION 'MIRROR_PROVIDER_RULE_UNRESOLVED: canonical payment % has incomplete provider identity', NEW.id;
  END IF;
  v_payment_date := (COALESCE(NEW.paid_at, NEW.confirmed_at, NEW.created_at) AT TIME ZONE 'Asia/Jakarta')::date;
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
    RAISE EXCEPTION 'CANONICAL_PROVIDER_RULE_UNRESOLVED: no owner-approved rule for company %, provider %, bank %',
      v_company_id, v_provider_code, v_external_bank_account_id;
  ELSIF v_company_count > 1 THEN
    RAISE EXCEPTION 'CANONICAL_PROVIDER_RULE_UNRESOLVED: multiple owner-approved rules';
  END IF;
  v_expected_settlement_date := v_payment_date;
  v_remaining := GREATEST(v_settlement_delay, 0);
  WHILE v_remaining > 0 LOOP
    v_expected_settlement_date := v_expected_settlement_date + 1;
    SELECT COALESCE(pbc.is_business_day, TRUE) INTO v_business_day
      FROM sport_center.payment_business_calendar pbc
     WHERE pbc.calendar_date = v_expected_settlement_date;
    IF EXTRACT(ISODOW FROM v_expected_settlement_date) < 6 AND COALESCE(v_business_day, TRUE) THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;
  LOOP
    SELECT COALESCE(pbc.is_business_day, TRUE) INTO v_business_day
      FROM sport_center.payment_business_calendar pbc
     WHERE pbc.calendar_date = v_expected_settlement_date;
    EXIT WHEN EXTRACT(ISODOW FROM v_expected_settlement_date) < 6 AND COALESCE(v_business_day, TRUE);
    v_expected_settlement_date := v_expected_settlement_date + 1;
  END LOOP;

  INSERT INTO public.sport_payments
    (booking_id, payment_number, amount, method, status, paid_at, payment_type, tax_rate, tax_amount,
     source, posting_status, company_id, provider_id, payment_provider, provider_code,
     bank_account_id, external_bank_account_id, expected_settlement_date, settlement_rule_version,
     settlement_status, source_schema, source_table, source_payment_id, created_at, updated_at)
  VALUES
    (v_public_booking_id, v_payment_number, NEW.amount,
     COALESCE(NEW.payment_method, 'Transfer Bank'),
     'paid', COALESCE(NEW.confirmed_at, NEW.created_at),
     COALESCE(NEW.payment_type::text, 'full_payment'),
     COALESCE(v_booking_tax_rate, 0), 0,
     'SPORT_CENTER_SUPABASE', 'unposted',
     v_company_id, v_provider_id, v_provider_name, v_provider_code,
     v_internal_bank_account_id, v_external_bank_account_id,
     v_expected_settlement_date::text, v_provider_rule_version,
     COALESCE(NULLIF(BTRIM(NEW.settlement_status::text), ''), 'unsettled'),
     'sport_center', 'sport_payments', NEW.id,
     NEW.created_at, now())
  ON CONFLICT (payment_number) DO UPDATE
    SET booking_id                = COALESCE(public.sport_payments.booking_id, EXCLUDED.booking_id),
        company_id                = EXCLUDED.company_id,
        provider_id               = EXCLUDED.provider_id,
        payment_provider          = EXCLUDED.payment_provider,
        provider_code             = EXCLUDED.provider_code,
        bank_account_id           = EXCLUDED.bank_account_id,
        external_bank_account_id  = EXCLUDED.external_bank_account_id,
        expected_settlement_date  = EXCLUDED.expected_settlement_date,
        settlement_rule_version   = EXCLUDED.settlement_rule_version,
        settlement_status         = EXCLUDED.settlement_status,
        source_schema             = EXCLUDED.source_schema,
        source_table              = EXCLUDED.source_table,
        source_payment_id         = EXCLUDED.source_payment_id,
        amount     = CASE WHEN public.sport_payments.posting_status IN ('unposted','failed') THEN EXCLUDED.amount     ELSE public.sport_payments.amount     END,
        method     = CASE WHEN public.sport_payments.posting_status IN ('unposted','failed') THEN EXCLUDED.method     ELSE public.sport_payments.method     END,
        paid_at    = CASE WHEN public.sport_payments.posting_status IN ('unposted','failed') THEN EXCLUDED.paid_at    ELSE public.sport_payments.paid_at    END,
        payment_type = CASE WHEN public.sport_payments.posting_status IN ('unposted','failed') THEN EXCLUDED.payment_type ELSE public.sport_payments.payment_type END,
        tax_rate   = CASE WHEN public.sport_payments.posting_status IN ('unposted','failed') THEN EXCLUDED.tax_rate   ELSE public.sport_payments.tax_rate   END,
        updated_at = now();
  RETURN NEW;
END;
$$;
