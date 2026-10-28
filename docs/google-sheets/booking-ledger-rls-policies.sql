-- Restricted RLS policies for the Sport Center backend DB role.
-- Applied to PROD on 2026-10-28 after postgres_logs confirmed RLS denial.
-- No grants are made to anon or authenticated.
DO $migration$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='booking_sheets_sync_ledger' AND policyname='booking_sheets_app_claim') THEN
   CREATE POLICY booking_sheets_app_claim ON sport_center.booking_sheets_sync_ledger
     FOR INSERT TO sport_center_app
     WITH CHECK (status='writing' AND attempt_count=1 AND payment_id IS NOT NULL AND company_invoice_id IS NULL);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='booking_sheets_sync_ledger' AND policyname='booking_sheets_app_read') THEN
   CREATE POLICY booking_sheets_app_read ON sport_center.booking_sheets_sync_ledger
     FOR SELECT TO sport_center_app USING (true);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='sport_center' AND tablename='booking_sheets_sync_ledger' AND policyname='booking_sheets_app_finalize') THEN
   CREATE POLICY booking_sheets_app_finalize ON sport_center.booking_sheets_sync_ledger
     FOR UPDATE TO sport_center_app
     USING (status='writing')
     WITH CHECK (status='written' AND sheet_row IS NOT NULL AND written_at IS NOT NULL);
 END IF;
END
$migration$;
