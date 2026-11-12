-- Additive, TEST-only metadata. No impact on balances, accounting or existing transactions.
ALTER TABLE sport_center.sc_finance_test_entries
  ADD COLUMN IF NOT EXISTS destination_account text;
-- Bank account is optional. Never insert it into public Google Sheets description.
DO $ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sc_finance_test_destination_account_valid'
   AND conrelid='sport_center.sc_finance_test_entries'::regclass) THEN
  ALTER TABLE sport_center.sc_finance_test_entries
    ADD CONSTRAINT sc_finance_test_destination_account_valid
    CHECK (destination_account IS NULL OR destination_account ~ '^[0-9]{6,24}
);
 END IF;
END $;
