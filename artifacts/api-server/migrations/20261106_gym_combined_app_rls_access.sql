-- Backend-only access for combined Gym receipt intake.
-- These are server-to-PostgreSQL tables, never exposed to anon/authenticated clients.
-- Resolve false 'nonmember not verified' when the backend is sport_center_app.
-- RLS remains enabled on all tables. No public policy is added.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sport_center_app') THEN
    RAISE EXCEPTION 'Required backend role sport_center_app is absent';
  END IF;
  IF to_regclass('sport_center.x904_verified_nonmember_identities') IS NULL
     OR to_regclass('sport_center.gym_combined_receipts') IS NULL
     OR to_regclass('sport_center.gym_combined_receipt_allocations') IS NULL THEN
    RAISE EXCEPTION 'Expected Gym registry/combined receipt tables are missing';
  END IF;
END $$;

-- Identity verification requires reading a verified X904 candidate; this does
-- not allow changing device membership, operating the door, or publishing PINs.
CREATE POLICY gym_nonmember_registry_backend_read
 ON sport_center.x904_verified_nonmember_identities
 FOR SELECT TO sport_center_app USING (true);

-- Receipt intake needs INSERT and read-back only; completion requires a
-- separate audited workflow and is intentionally NOT granted UPDATE/DELETE.
CREATE POLICY gym_combined_receipts_backend_read
 ON sport_center.gym_combined_receipts
 FOR SELECT TO sport_center_app USING (true);
CREATE POLICY gym_combined_receipts_backend_insert
 ON sport_center.gym_combined_receipts
 FOR INSERT TO sport_center_app WITH CHECK (
   status='awaiting_bank_verification'
   AND bank_mutation_id IS NULL
   AND verified_at IS NULL
   AND verified_by IS NULL
 );

CREATE POLICY gym_combined_allocations_backend_read
 ON sport_center.gym_combined_receipt_allocations
 FOR SELECT TO sport_center_app USING (true);
CREATE POLICY gym_combined_allocations_backend_insert
 ON sport_center.gym_combined_receipt_allocations
 FOR INSERT TO sport_center_app WITH CHECK (
   status='pending'
   AND membership_payment_id IS NULL
 );

-- Explicitly ensure both source and new tables stay RLS protected.
ALTER TABLE sport_center.x904_verified_nonmember_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_combined_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sport_center.gym_combined_receipt_allocations ENABLE ROW LEVEL SECURITY;
