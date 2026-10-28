ALTER TABLE sport_center.accounting_journals
  ADD COLUMN IF NOT EXISTS pph_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS pph_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS net_amount numeric(14,2);

COMMENT ON COLUMN sport_center.accounting_journals.pph_rate
  IS 'PPh withholding rate snapshot for confirmed payment accounting.';
COMMENT ON COLUMN sport_center.accounting_journals.pph_amount
  IS 'PPh withholding amount snapshot for confirmed payment accounting.';
COMMENT ON COLUMN sport_center.accounting_journals.net_amount
  IS 'Net cash amount after withholding for confirmed payment accounting.';
