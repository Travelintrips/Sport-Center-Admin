-- Keep the Supabase settings table aligned with the application schema.
ALTER TABLE sport_center.settings
  ADD COLUMN IF NOT EXISTS fonnte_token text,
  ADD COLUMN IF NOT EXISTS fonnte_admin_wa text,
  ADD COLUMN IF NOT EXISTS admin_wa_phones text,
  ADD COLUMN IF NOT EXISTS app_url text;