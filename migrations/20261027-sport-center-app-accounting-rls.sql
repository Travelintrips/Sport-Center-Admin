-- Allow only the dedicated Sport Center backend database role to cross the
-- BizPortal accounting RLS boundary. anon/authenticated deny policies remain.
-- Deliberately no DELETE policies.
DROP POLICY IF EXISTS sport_center_app_select ON public.sport_bookings;
DROP POLICY IF EXISTS sport_center_app_insert ON public.sport_bookings;
DROP POLICY IF EXISTS sport_center_app_update ON public.sport_bookings;
CREATE POLICY sport_center_app_select ON public.sport_bookings FOR SELECT TO sport_center_app USING (true);
CREATE POLICY sport_center_app_insert ON public.sport_bookings FOR INSERT TO sport_center_app WITH CHECK (true);
CREATE POLICY sport_center_app_update ON public.sport_bookings FOR UPDATE TO sport_center_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.sport_payments;
DROP POLICY IF EXISTS sport_center_app_insert ON public.sport_payments;
DROP POLICY IF EXISTS sport_center_app_update ON public.sport_payments;
CREATE POLICY sport_center_app_select ON public.sport_payments FOR SELECT TO sport_center_app USING (true);
CREATE POLICY sport_center_app_insert ON public.sport_payments FOR INSERT TO sport_center_app WITH CHECK (true);
CREATE POLICY sport_center_app_update ON public.sport_payments FOR UPDATE TO sport_center_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.accounting_entries;
DROP POLICY IF EXISTS sport_center_app_insert ON public.accounting_entries;
DROP POLICY IF EXISTS sport_center_app_update ON public.accounting_entries;
CREATE POLICY sport_center_app_select ON public.accounting_entries FOR SELECT TO sport_center_app USING (true);
CREATE POLICY sport_center_app_insert ON public.accounting_entries FOR INSERT TO sport_center_app WITH CHECK (true);
CREATE POLICY sport_center_app_update ON public.accounting_entries FOR UPDATE TO sport_center_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.accounting_entry_lines;
DROP POLICY IF EXISTS sport_center_app_insert ON public.accounting_entry_lines;
CREATE POLICY sport_center_app_select ON public.accounting_entry_lines FOR SELECT TO sport_center_app USING (true);
CREATE POLICY sport_center_app_insert ON public.accounting_entry_lines FOR INSERT TO sport_center_app WITH CHECK (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.accounting_journals;
CREATE POLICY sport_center_app_select ON public.accounting_journals FOR SELECT TO sport_center_app USING (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.chart_of_accounts;
CREATE POLICY sport_center_app_select ON public.chart_of_accounts FOR SELECT TO sport_center_app USING (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.accounting_taxes;
CREATE POLICY sport_center_app_select ON public.accounting_taxes FOR SELECT TO sport_center_app USING (true);

DROP POLICY IF EXISTS sport_center_app_select ON public.gl_tax_lines;
DROP POLICY IF EXISTS sport_center_app_insert ON public.gl_tax_lines;
CREATE POLICY sport_center_app_select ON public.gl_tax_lines FOR SELECT TO sport_center_app USING (true);
CREATE POLICY sport_center_app_insert ON public.gl_tax_lines FOR INSERT TO sport_center_app WITH CHECK (true);
