-- Existing sport_center.sc_income_entries had RLS enabled with zero policies.
-- An authenticated web admin reaches the backend, but the backend database login
-- sport_center_app cannot INSERT/SELECT/UPDATE without narrowly scoped policies.
-- Only this internal SQL login is granted access; no anon/authenticated/public grants.
-- Delete remains denied, so operational audit records cannot be deleted via this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='sc_income_entries' AND policyname='sc_income_internal_select') THEN
    CREATE POLICY sc_income_internal_select ON sport_center.sc_income_entries FOR SELECT TO sport_center_app USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='sc_income_entries' AND policyname='sc_income_internal_insert') THEN
    CREATE POLICY sc_income_internal_insert ON sport_center.sc_income_entries FOR INSERT TO sport_center_app WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='sc_income_entries' AND policyname='sc_income_internal_update') THEN
    CREATE POLICY sc_income_internal_update ON sport_center.sc_income_entries FOR UPDATE TO sport_center_app USING (true) WITH CHECK (true);
  END IF;
END $$;
