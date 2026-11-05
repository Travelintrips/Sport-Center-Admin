-- Save the human visitor's name separately from the permanent X904 card label.
-- Existing bookings and card names stay unchanged.
BEGIN;
ALTER TABLE sport_center.x904_nonmember_daily_access
  ADD COLUMN IF NOT EXISTS visitor_name text;
ALTER TABLE sport_center.x904_nonmember_daily_access
  ADD CONSTRAINT x904_nonmember_daily_visitor_name_check
  CHECK (visitor_name IS NULL OR (char_length(btrim(visitor_name)) BETWEEN 2 AND 100));
COMMIT;
