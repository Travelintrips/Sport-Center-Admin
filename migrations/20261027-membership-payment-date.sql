ALTER TABLE sport_center.sport_membership_payments
ADD COLUMN IF NOT EXISTS payment_date text;

COMMENT ON COLUMN sport_center.sport_membership_payments.payment_date
IS 'Actual customer payment transaction date in Asia/Jakarta, YYYY-MM-DD. Audit submission/confirmation timestamps remain in submitted_at/confirmed_at.';
