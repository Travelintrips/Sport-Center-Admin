-- Security hardening of existing invoice period limit trigger only.
-- No change to maximum-two-invoices rule or invoice data.
-- CST-DEV does not carry this historical PROD trigger; leave it absent there.
-- In PROD validate existing trigger and function body before setting search_path.
DO $fix$
DECLARE f_oid oid;
BEGIN
 SELECT to_regprocedure('sport_center.enforce_company_invoice_period_limit()') INTO f_oid;
 IF f_oid IS NULL THEN
   RAISE NOTICE 'invoice period trigger absent in this environment; no change';
 ELSE
   IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f_oid
     AND p.prorettype='trigger'::regtype AND NOT p.prosecdef
     AND position('Maximum 2 invoices per company per month' in pg_get_functiondef(p.oid))>0
     AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal)) THEN
     RAISE EXCEPTION 'invoice period guard definition drift';
   END IF;
   ALTER FUNCTION sport_center.enforce_company_invoice_period_limit()
     SET search_path TO pg_catalog,sport_center;
   IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=f_oid
     AND p.proconfig @> ARRAY['search_path=pg_catalog, sport_center']::text[]) THEN
     RAISE EXCEPTION 'invoice period trigger path not fixed';
   END IF;
 END IF;
END $fix$;
