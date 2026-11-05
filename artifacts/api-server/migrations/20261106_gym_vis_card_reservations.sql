-- Gym VIS reservation inventory: independent of the X904 door-grant worker.
-- Apply to CST-DEV first. Does not enable access or issue X904 commands.
CREATE TABLE IF NOT EXISTS sport_center.gym_vis_card_reservations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES sport_center.sport_bookings(id),
  payment_id INTEGER NOT NULL REFERENCES sport_center.sport_payments(id),
  device_serial TEXT NOT NULL DEFAULT 'TDBD234200545',
  card_code TEXT NOT NULL,
  user_pin TEXT NOT NULL,
  device_uid INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved',
  funds_reference TEXT NOT NULL,
  funds_verified_by TEXT NOT NULL,
  funds_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  CONSTRAINT gym_vis_res_booking_uniq UNIQUE (booking_id),
  CONSTRAINT gym_vis_res_funds_ref_uniq UNIQUE (funds_reference),
  CONSTRAINT gym_vis_res_state_valid CHECK (state IN ('reserved','collected','returned','cancelled')),
  CONSTRAINT gym_vis_res_card_pair_valid CHECK (
    (card_code='VIS001' AND user_pin='78' AND device_uid=338) OR
    (card_code='VIS002' AND user_pin='90' AND device_uid=339) OR
    (card_code='VIS003' AND user_pin='13' AND device_uid=13) OR
    (card_code='VIS004' AND user_pin='17' AND device_uid=17) OR
    (card_code='VIS005' AND user_pin='11' AND device_uid=11) OR
    (card_code='VIS006' AND user_pin='15' AND device_uid=15)
  ),
  CONSTRAINT gym_vis_res_device_valid CHECK (device_serial='TDBD234200545')
);
-- One card can be reserved/collected by only one outstanding booking.
-- A returned physical card is made reusable only after a staff read-back action.
CREATE UNIQUE INDEX IF NOT EXISTS gym_vis_res_card_active_uniq
  ON sport_center.gym_vis_card_reservations (device_serial, card_code)
  WHERE state IN ('reserved','collected');
CREATE INDEX IF NOT EXISTS gym_vis_res_payment_idx
  ON sport_center.gym_vis_card_reservations (payment_id);
REVOKE ALL ON sport_center.gym_vis_card_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE sport_center.gym_vis_card_reservations_id_seq FROM PUBLIC, anon, authenticated;

-- Defensive isolation even if sport_center is added to exposed Data API schemas.
ALTER TABLE sport_center.gym_vis_card_reservations ENABLE ROW LEVEL SECURITY;
