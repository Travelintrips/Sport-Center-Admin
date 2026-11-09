-- Allow only the internal SC DB login to inspect cash account id 1 for target verification.
-- No public, anon or authenticated access, no insert/update/delete grants.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='company_bank_accounts'
      AND policyname='sc_income_cash_account_internal_read'
  ) THEN
    CREATE POLICY sc_income_cash_account_internal_read
      ON public.company_bank_accounts FOR SELECT TO sport_center_app
      USING (id=1 AND company_id=1 AND account_type='cash');
  END IF;
END $$;
