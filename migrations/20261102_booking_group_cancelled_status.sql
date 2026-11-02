-- Allow booking groups to carry an explicit cancellation state.
-- Existing groups and booking/payment rows are not modified by this migration.
ALTER TYPE sport_center.booking_group_status ADD VALUE IF NOT EXISTS 'cancelled';
