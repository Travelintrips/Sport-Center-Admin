-- Manage the public website Mina chat widget from sport_center.sport_settings.
alter table sport_center.sport_settings
  add column if not exists mina_web_chat_enabled boolean not null default true,
  add column if not exists mina_web_chat_greeting text not null
    default 'Halo! Saya Mina, asisten Sport Center. Ada yang bisa saya bantu?',
  add column if not exists mina_web_chat_quick_actions text not null
    default E'Booking Fasilitas\nCek Jadwal\nCek Harga\nGym & Membership';
