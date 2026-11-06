-- Additive salary field. Existing employees remain NULL until entered.
ALTER TABLE sport_center.sc_employees
ADD COLUMN IF NOT EXISTS salary numeric(15,2);
ALTER TABLE sport_center.sc_employees
DROP CONSTRAINT IF EXISTS sc_employees_salary_nonnegative;
ALTER TABLE sport_center.sc_employees
ADD CONSTRAINT sc_employees_salary_nonnegative CHECK (salary >= 0);
