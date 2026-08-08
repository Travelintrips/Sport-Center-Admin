-- Add vendor_id FK column to sport_center.sport_expenses
-- This links expenses to the sport_vendors master list

ALTER TABLE sport_center.sport_expenses
  ADD COLUMN IF NOT EXISTS vendor_id INTEGER
    REFERENCES sport_center.sport_vendors(id)
    ON DELETE SET NULL;

-- Backfill vendor_id from vendor_name where possible (best-effort match)
UPDATE sport_center.sport_expenses e
SET vendor_id = v.id
FROM sport_center.sport_vendors v
WHERE e.vendor_name IS NOT NULL
  AND lower(trim(e.vendor_name)) = lower(trim(v.name))
  AND e.vendor_id IS NULL;
