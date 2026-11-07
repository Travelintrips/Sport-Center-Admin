-- PR: simplified SC expense input; metadata ONLY. No GL, payments, or bank mutation writes.
ALTER TABLE sport_center.sport_expenses
  ADD COLUMN IF NOT EXISTS bank_reference text;
ALTER TABLE public.sport_center_expenses
  ADD COLUMN IF NOT EXISTS bank_reference text;
-- Both fields are optional; historical expenses remain unchanged.
