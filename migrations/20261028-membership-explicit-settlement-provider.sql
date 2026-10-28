-- DEV-first additive provider selection. Never infer processor from QRIS alone.
-- Existing records remain unchanged; single owner-approved provider still resolves.
ALTER TABLE sport_center.sport_membership_payments
  ADD COLUMN IF NOT EXISTS settlement_provider_code text;

DO $migration$
DECLARE
  original_function text;
  match_line text := E'AND psc.source = ''OWNER_APPROVED''\n         AND psc.effective_from';
  replacement text := E'AND psc.source = ''OWNER_APPROVED''\n         AND (NEW.settlement_provider_code IS NULL OR LOWER(BTRIM(psc.provider_code)) = LOWER(BTRIM(NEW.settlement_provider_code)))\n         AND psc.effective_from';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO original_function
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='sport_center' AND p.proname='sync_membership_payment_to_canonical';
  IF original_function IS NULL THEN
    RAISE EXCEPTION 'CANONICAL_MEMBERSHIP_TRIGGER_MISSING';
  END IF;
  IF original_function NOT LIKE '%' || match_line || '%' THEN
    IF original_function LIKE '%' || replacement || '%' THEN RETURN; END IF;
    RAISE EXCEPTION 'CANONICAL_MEMBERSHIP_TRIGGER_UNEXPECTED_VERSION';
  END IF;
  EXECUTE replace(original_function,match_line,replacement);
END;
$migration$;
