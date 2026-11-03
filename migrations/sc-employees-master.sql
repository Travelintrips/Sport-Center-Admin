-- Apply to the sport_center schema before deploying the SC Employees API.
CREATE TABLE IF NOT EXISTS sport_center.sc_employees (
  employee_id text PRIMARY KEY CHECK (employee_id ~ '^[A-Z0-9_-]{2,32}$'),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 150),
  whatsapp_number text NOT NULL UNIQUE CHECK (whatsapp_number ~ '^62[0-9]{8,13}$'),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sport_center.sc_employees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sport_center.sc_employees FROM anon, authenticated;

