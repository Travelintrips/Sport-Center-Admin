ALTER TABLE sport_center.sport_settings
  ADD COLUMN IF NOT EXISTS mina_wa_provider text NOT NULL DEFAULT 'fonnte';

ALTER TABLE sport_center.sport_settings
  ADD COLUMN IF NOT EXISTS wa_gateway_mina_device_id text;
