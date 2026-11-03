-- Disposable CI-only schema for processX904Event application E2E.
-- This database is a local PostgreSQL service container and has no route to Supabase or X904.
CREATE SCHEMA IF NOT EXISTS sport_center;

CREATE TABLE sport_center.x904_user_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_serial text NOT NULL,
  command_type text NOT NULL CHECK (command_type IN ('CREATE_USER','UPDATE_USER','DELETE_USER','SUSPEND_USER','ACTIVATE_USER')),
  user_pin text NOT NULL CHECK (user_pin ~ '^[0-9]{1,12}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','completed','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE sport_center.sport_memberships (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  email text,
  phone text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  months integer NOT NULL DEFAULT 1,
  total_price numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL,
  notes text
);

CREATE TABLE sport_center.sport_membership_payments (
  id bigserial PRIMARY KEY,
  membership_id bigint NOT NULL REFERENCES sport_center.sport_memberships(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  period_start date NOT NULL,
  period_end date NOT NULL
);

CREATE TABLE sport_center.gym_x904_lan_users (
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  device_uid integer NOT NULL,
  display_name text NOT NULL,
  device_role integer NOT NULL DEFAULT 0,
  last_seen_snapshot uuid,
  PRIMARY KEY(device_serial,user_pin)
);

CREATE TABLE sport_center.gym_x904_member_mapping (
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  membership_id bigint REFERENCES sport_center.sport_memberships(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('verified','review_required','inactive')),
  verified_at timestamptz,
  verified_by text,
  PRIMARY KEY(device_serial,user_pin),
  CHECK (status <> 'verified' OR (membership_id IS NOT NULL AND verified_at IS NOT NULL AND verified_by IS NOT NULL))
);

CREATE TABLE sport_center.gym_x904_raw_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[a-f0-9]{64}$'),
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  device_time text NOT NULL,
  attendance_status integer,
  verification_type integer
);

CREATE TABLE sport_center.gym_x904_verification_evidence (
  id bigserial PRIMARY KEY,
  source_event_id text NOT NULL,
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  evidence_status text NOT NULL,
  capture_source text NOT NULL,
  verification_code integer NOT NULL,
  verification_method text NOT NULL
);

CREATE TABLE sport_center.gym_x904_processed_events (
  event_id text PRIMARY KEY REFERENCES sport_center.gym_x904_raw_events(event_id) ON DELETE RESTRICT,
  device_serial text NOT NULL,
  user_pin text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','failed','review_required'))
);

CREATE TABLE sport_center.gym_checkins (
  id bigserial PRIMARY KEY,
  membership_id bigint NOT NULL REFERENCES sport_center.sport_memberships(id) ON DELETE CASCADE,
  checkin_date date NOT NULL,
  checked_in_at timestamptz NOT NULL,
  notes text,
  x904_event_id text UNIQUE
);

CREATE TABLE sport_center.sport_bookings (
  id bigserial PRIMARY KEY,
  notes text,
  total_price numeric(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE sport_center.booking_history (
  id bigserial PRIMARY KEY,
  note text
);
