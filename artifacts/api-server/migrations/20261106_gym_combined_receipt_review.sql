-- One physical bank transfer may settle multiple membership periods.
-- Intake only: no automatic membership confirmation, X904 grant, journal or bank mutation.
-- All allocations must be validated by the authenticated API before insertion.
CREATE TABLE IF NOT EXISTS sport_center.gym_combined_receipts (
  id bigserial PRIMARY KEY,
  reference text NOT NULL,
  proof_sha256 text NOT NULL,
  proof_url text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('qris','transfer')),
  payment_date date NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_bank_verification'
    CHECK (status IN ('awaiting_bank_verification','verified','rejected','cancelled')),
  bank_mutation_id integer REFERENCES sport_center.bank_mutations(id),
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_combined_receipts_reference_unique UNIQUE (reference),
  CONSTRAINT gym_combined_receipts_proof_hash_unique UNIQUE (proof_sha256),
  CONSTRAINT gym_combined_receipts_verified_evidence_check CHECK
    (status <> 'verified' OR (bank_mutation_id IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sport_center.gym_combined_receipt_allocations (
  id bigserial PRIMARY KEY,
  receipt_id bigint NOT NULL REFERENCES sport_center.gym_combined_receipts(id) ON DELETE RESTRICT,
  device_serial text NOT NULL DEFAULT 'TDBD234200545',
  user_pin text NOT NULL CHECK (user_pin ~ '^[0-9]{1,8}$'),
  device_uid integer NOT NULL CHECK (device_uid > 0),
  device_name text NOT NULL,
  membership_id integer REFERENCES sport_center.sport_memberships(id),
  membership_payment_id integer REFERENCES sport_center.sport_membership_payments(id),
  allocation_kind text NOT NULL CHECK (allocation_kind IN ('new','renew')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','linked','confirmed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gym_combined_receipt_pin_unique UNIQUE(receipt_id,device_serial,user_pin),
  CONSTRAINT gym_combined_receipt_membership_payment_unique UNIQUE(membership_payment_id),
  CONSTRAINT gym_combined_receipt_kind_check CHECK
    (allocation_kind <> 'renew' OR membership_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS gym_combined_receipt_allocations_receipt_idx
  ON sport_center.gym_combined_receipt_allocations(receipt_id);
COMMENT ON TABLE sport_center.gym_combined_receipts IS
  'One verified external bank receipt; allocation records are not separate bank movements. Verification and settlement require a separate controlled action.';
