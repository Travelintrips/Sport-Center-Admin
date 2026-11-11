-- Optional cash-purpose label for SC finance TEST income. Existing rows remain empty.
ALTER TABLE sport_center.sc_finance_test_entries
 ADD COLUMN IF NOT EXISTS cash_type text NOT NULL DEFAULT '';
ALTER TABLE sport_center.sc_finance_test_entries
 DROP CONSTRAINT IF EXISTS sc_finance_test_cash_type_check;
ALTER TABLE sport_center.sc_finance_test_entries
 ADD CONSTRAINT sc_finance_test_cash_type_check
 CHECK (cash_type IN ('','kas kecil','kas besar'));
