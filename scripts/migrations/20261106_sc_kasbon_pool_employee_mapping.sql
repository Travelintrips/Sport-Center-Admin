-- Stable employee ID -> legacy label; no monthly row numbers or ENV edits.
CREATE TABLE IF NOT EXISTS sport_center.sc_kasbon_pool_employee_mapping (
 employee_id text PRIMARY KEY REFERENCES sport_center.sc_employees(employee_id) ON DELETE RESTRICT,
 sheet_label text NOT NULL,
 verified boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT sc_kasbon_pool_label_nonempty CHECK (length(trim(sheet_label)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS sc_kasbon_pool_label_unique
 ON sport_center.sc_kasbon_pool_employee_mapping(lower(trim(sheet_label)));

-- Verified references from November 2026 audit; never overwrite operator changes.
INSERT INTO sport_center.sc_kasbon_pool_employee_mapping(employee_id,sheet_label,verified)
VALUES ('SC003','Kasbon Robby',true),
       ('SC005','Kasbon SENO',true),
       ('SC007','Kasbon sandi',true),
       ('SC008','sonic',true)
ON CONFLICT(employee_id) DO NOTHING;

-- 'Mustofa' and 'Kabon Mustopa' differ: requires explicit verification.
-- SC004/Tri does not have an identified row in historical Kasbon POOL.
