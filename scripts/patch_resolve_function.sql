CREATE OR REPLACE FUNCTION sport_center.resolve_and_persist_payment_metadata(p_payment_id integer)
 RETURNS TABLE(resolved_company_id integer, resolved_expected_settlement_date date, resolved_rule_version text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'sport_center', 'public'
AS $function$
    DECLARE
      v_payment sport_center.sport_payments%ROWTYPE;
      v_facility_id integer;
      v_company_id integer;
      v_company_count integer;
      v_external_bank_account_id text;
      v_bank_account_id integer;
      v_bank_account_count integer;
      v_provider_id text;
      v_provider_name text;
      v_provider_code text;
      v_rule_id integer;
      v_rule_version text;
      v_settlement_delay integer;
      v_min_settlement_delay integer;
      v_max_settlement_delay integer;
      v_payment_date date;
      v_expected_settlement_date date;
      v_business_day boolean;
      v_remaining integer;
    BEGIN
      PERFORM pg_advisory_xact_lock(731026, p_payment_id);

      SELECT *
        INTO v_payment
        FROM sport_center.sport_payments
       WHERE id = p_payment_id
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CANONICAL_PAYMENT_NOT_FOUND: %', p_payment_id;
      END IF;

      IF v_payment.status::text <> 'confirmed' THEN
        RAISE EXCEPTION 'CANONICAL_PAYMENT_NOT_CONFIRMED: payment=% status=%',
          p_payment_id, v_payment.status;
      END IF;

      SELECT sb.facility_id
        INTO v_facility_id
        FROM sport_center.sport_bookings sb
       WHERE sb.id = v_payment.booking_id;

      IF NOT FOUND OR v_facility_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_COMPANY_UNRESOLVED: payment=% booking=%',
          p_payment_id, v_payment.booking_id;
      END IF;

      SELECT COUNT(*)::integer, MIN(fcm.company_id)
        INTO v_company_count, v_company_id
        FROM sport_center.facility_company_mappings fcm
        WHERE fcm.facility_id = v_facility_id
          AND fcm.is_active = TRUE
          AND fcm.approval_status = 'OWNER_APPROVED';

      IF v_company_count <> 1 OR v_company_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_COMPANY_UNRESOLVED: facility=% active_mappings=%',
          v_facility_id, v_company_count;
      END IF;

       v_provider_code := NULLIF(LOWER(BTRIM(v_payment.payment_provider::text)), '');

       -- Manual receipts (Transfer Bank, cash, DANA, and legacy rows) are
       -- recorded with provider_code = unknown. They are valid confirmed
       -- payments, but they do not settle through an owner-approved processor
       -- rule. Do not invent a settlement rule or account for them.
       IF v_provider_code IS NULL OR v_provider_code = 'unknown' THEN
         UPDATE sport_center.sport_payments
            SET company_id = v_company_id,
                expected_settlement_date = NULL,
                settlement_rule_version = NULL
          WHERE id = p_payment_id
            AND status::text = 'confirmed';

         resolved_company_id := v_company_id;
         resolved_expected_settlement_date := NULL;
         resolved_rule_version := NULL;
         RETURN NEXT;
         RETURN;
       END IF;

       v_external_bank_account_id := NULLIF(BTRIM(v_payment.bank_account_id::text), '');
      IF v_external_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_BANK_ACCOUNT_UNRESOLVED: payment=%', p_payment_id;
      END IF;

      SELECT COUNT(*)::integer, MIN(cba.id)
        INTO v_bank_account_count, v_bank_account_id
        FROM public.company_bank_accounts cba
       WHERE cba.company_id = v_company_id
         AND cba.account_number::text = v_external_bank_account_id
         AND cba.is_active = TRUE;

      IF v_bank_account_count <> 1 OR v_bank_account_id IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_BANK_ACCOUNT_UNRESOLVED: company=% account=% matches=%',
          v_company_id, v_external_bank_account_id, v_bank_account_count;
      END IF;

      v_provider_id := NULLIF(BTRIM(v_payment.provider_id::text), '');
      v_provider_name := NULLIF(BTRIM(v_payment.provider_name::text), '');
      IF v_provider_id IS NULL OR v_provider_name IS NULL OR v_provider_code IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_PROVIDER_UNRESOLVED: payment=%', p_payment_id;
      END IF;

      v_payment_date := (COALESCE(
        v_payment.paid_at,
        v_payment.confirmed_at,
        v_payment.created_at
      ) AT TIME ZONE 'Asia/Jakarta')::date;

       SELECT COUNT(*)::integer,
              MIN(psc.settlement_delay_business_days),
              MAX(psc.settlement_delay_business_days)
         INTO v_company_count, v_min_settlement_delay, v_max_settlement_delay
        FROM sport_center.payment_settlement_configs psc
       WHERE psc.company_id = v_company_id
         AND LOWER(BTRIM(psc.provider_code)) = v_provider_code
         AND psc.bank_account_id = v_external_bank_account_id
         AND psc.is_active = TRUE
         AND psc.source = 'OWNER_APPROVED'
         AND psc.effective_from <= v_payment_date
         -- effective_until is inclusive, matching the settlement-config API.
         AND (psc.effective_until IS NULL OR v_payment_date <= psc.effective_until);

       IF v_company_count = 0
          OR v_min_settlement_delay IS NULL
          OR v_max_settlement_delay IS NULL THEN
        RAISE EXCEPTION 'CANONICAL_PROVIDER_RULE_UNRESOLVED: company=% provider=% bank=% matches=%',
          v_company_id, v_provider_code, v_external_bank_account_id, v_company_count;
      END IF;

       -- Legacy configurations may overlap while being migrated from one
       -- effective period to the next. They are deterministic only when their
       -- settlement delay agrees; the latest effective start is the winner.
       SELECT MIN(psc.settlement_delay_business_days),
              MAX(psc.settlement_delay_business_days)
         INTO v_min_settlement_delay, v_max_settlement_delay
         FROM sport_center.payment_settlement_configs psc
        WHERE psc.company_id = v_company_id
          AND LOWER(BTRIM(psc.provider_code)) = v_provider_code
          AND psc.bank_account_id = v_external_bank_account_id
          AND psc.is_active = TRUE
          AND psc.source = 'OWNER_APPROVED'
          AND psc.effective_from <= v_payment_date
          -- effective_until is inclusive, matching the settlement-config API.
          AND (psc.effective_until IS NULL OR v_payment_date <= psc.effective_until);

       IF v_min_settlement_delay IS DISTINCT FROM v_max_settlement_delay THEN
         RAISE EXCEPTION 'CANONICAL_PROVIDER_RULE_UNRESOLVED: company=% provider=% bank=% conflicting_delays',
           v_company_id, v_provider_code, v_external_bank_account_id;
       END IF;

       SELECT psc.id,
              psc.rule_version,
              psc.settlement_delay_business_days
         INTO v_rule_id, v_rule_version, v_settlement_delay
         FROM sport_center.payment_settlement_configs psc
        WHERE psc.company_id = v_company_id
          AND LOWER(BTRIM(psc.provider_code)) = v_provider_code
          AND psc.bank_account_id = v_external_bank_account_id
          AND psc.is_active = TRUE
          AND psc.source = 'OWNER_APPROVED'
          AND psc.effective_from <= v_payment_date
          -- effective_until is inclusive, matching the settlement-config API.
          AND (psc.effective_until IS NULL OR v_payment_date <= psc.effective_until)
        ORDER BY psc.effective_from DESC, psc.id DESC
        LIMIT 1;

       -- Older UI-created rules predate rule_version. Preserve an auditable
       -- stable identifier without requiring a data rewrite.
       v_rule_version := COALESCE(v_rule_version, 'LEGACY-MANDIRI-' || v_rule_id::text);

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

      UPDATE sport_center.sport_payments
         SET company_id = v_company_id,
             expected_settlement_date = v_expected_settlement_date,
             settlement_rule_version = v_rule_version
       WHERE id = p_payment_id
         AND status::text = 'confirmed';

      resolved_company_id := v_company_id;
      resolved_expected_settlement_date := v_expected_settlement_date;
      resolved_rule_version := v_rule_version;
      RETURN NEXT;
    END;
    $function$
