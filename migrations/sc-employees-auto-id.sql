BEGIN;
LOCK TABLE sport_center.sc_employees IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE IF NOT EXISTS sport_center.sc_employees_id_seq AS bigint START WITH 1 INCREMENT BY 1;
ALTER SEQUENCE sport_center.sc_employees_id_seq OWNED BY sport_center.sc_employees.employee_id;
SELECT setval('sport_center.sc_employees_id_seq'::regclass,
 GREATEST(COALESCE((SELECT max(substring(employee_id from 3)::bigint)
 FROM sport_center.sc_employees WHERE employee_id ~ '^SC[0-9]{1,18}$'), 0) + 1,
 (SELECT last_value FROM sport_center.sc_employees_id_seq)), false);
ALTER TABLE sport_center.sc_employees ALTER COLUMN employee_id SET DEFAULT (
 'SC' || lpad(nextval('sport_center.sc_employees_id_seq'::regclass)::text, 3, '0'));
REVOKE ALL ON SEQUENCE sport_center.sc_employees_id_seq FROM PUBLIC, anon, authenticated;
COMMIT;
