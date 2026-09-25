-- Dedicated human Customer Service WhatsApp contact.
-- Stored in sport_center.sport_settings; intentionally separate from Mina and
-- from internal admin/group notification recipients.
alter table sport_center.sport_settings
  add column if not exists customer_service_whatsapp text;

-- Retire the known inactive admin recipient without touching the Fonnte token.
update sport_center.sport_settings
set
  fonnte_admin_wa = case
    when regexp_replace(coalesce(fonnte_admin_wa, ''), '[^0-9]', '', 'g')
         in ('085121073537', '6285121073537')
      then null
    else fonnte_admin_wa
  end,
  admin_wa_phones = trim(both ',' from
    replace(
      replace(coalesce(admin_wa_phones, ''), '085121073537,', ''),
      ',085121073537', ''
    )
  ),
  updated_at = now();
