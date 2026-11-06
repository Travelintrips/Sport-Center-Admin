-- Apply first to isolated DEV; do not execute in PROD without validated release.
CREATE TABLE IF NOT EXISTS sport_center.sc_employee_kasbon (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 employee_id text NOT NULL REFERENCES sport_center.sc_employees(employee_id) ON DELETE RESTRICT,
 kasbon_date date NOT NULL,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 notes text NOT NULL DEFAULT '',
 proof_url text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sc_employee_kasbon_employee_date_idx
  ON sport_center.sc_employee_kasbon(employee_id, kasbon_date DESC, id DESC);
-- No grants to anon or authenticated: access exclusively via admin-authenticated server endpoints.
