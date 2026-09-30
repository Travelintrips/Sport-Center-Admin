ALTER TABLE sport_center.sport_settings
  ADD COLUMN IF NOT EXISTS admin_group_provider text NOT NULL DEFAULT 'fonnte';

ALTER TABLE sport_center.sport_settings
  ADD COLUMN IF NOT EXISTS wa_gateway_admin_group_id text;
