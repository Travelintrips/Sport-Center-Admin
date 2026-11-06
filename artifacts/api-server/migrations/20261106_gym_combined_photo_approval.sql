-- Photo approval is an operator attestation, NOT bank settlement.
-- One atomic receipt may confirm multiple membership periods without creating bank_mutations.
ALTER TABLE sport_center.gym_combined_receipts
  DROP CONSTRAINT IF EXISTS gym_combined_receipts_status_check;
ALTER TABLE sport_center.gym_combined_receipts
  ADD CONSTRAINT gym_combined_receipts_status_check
  CHECK(status IN ('awaiting_bank_verification','photo_approved','verified','rejected','cancelled'));
ALTER TABLE sport_center.gym_combined_receipts
  ADD COLUMN IF NOT EXISTS photo_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_approved_by text;
ALTER TABLE sport_center.gym_combined_receipts
  ADD CONSTRAINT gym_combined_receipts_photo_approval_guard
  CHECK(status <> 'photo_approved' OR
    (photo_approved_at IS NOT NULL AND photo_approved_by IS NOT NULL AND
     bank_mutation_id IS NULL AND verified_at IS NULL));
CREATE TABLE IF NOT EXISTS sport_center.gym_combined_photo_approval_audit (
  receipt_id bigint PRIMARY KEY REFERENCES sport_center.gym_combined_receipts(id),
  actor text NOT NULL,
  decision text NOT NULL CHECK(decision='PHOTO_APPROVED_NOT_BANK_VERIFIED'),
  allocation_count integer NOT NULL CHECK(allocation_count >= 2),
  total_amount numeric(14,2) NOT NULL CHECK(total_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sport_center.gym_combined_photo_approval_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sport_center.gym_combined_photo_approval_audit TO sport_center_app;
CREATE POLICY gym_combined_photo_audit_backend_read
 ON sport_center.gym_combined_photo_approval_audit
 FOR SELECT TO sport_center_app USING(true);
CREATE POLICY gym_combined_photo_audit_backend_insert
 ON sport_center.gym_combined_photo_approval_audit
 FOR INSERT TO sport_center_app WITH CHECK(decision='PHOTO_APPROVED_NOT_BANK_VERIFIED');

CREATE POLICY gym_combined_receipts_backend_photo_approval
 ON sport_center.gym_combined_receipts FOR UPDATE TO sport_center_app
 USING(status='awaiting_bank_verification')
 WITH CHECK(status='photo_approved' AND bank_mutation_id IS NULL
   AND verified_at IS NULL AND photo_approved_at IS NOT NULL AND photo_approved_by IS NOT NULL);
CREATE POLICY gym_combined_allocations_backend_photo_approval
 ON sport_center.gym_combined_receipt_allocations FOR UPDATE TO sport_center_app
 USING(status='pending')
 WITH CHECK(status='confirmed' AND membership_id IS NOT NULL AND membership_payment_id IS NOT NULL);
