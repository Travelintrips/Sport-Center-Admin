-- Branded 8-character payment-proof links for WhatsApp notifications.
-- Public URL format: https://sc.travelintrips.co.id/proof/<8-char-code>
create table if not exists sport_center.payment_proof_short_links (
  code varchar(8) primary key,
  proof_url text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_proof_short_links_created_at
  on sport_center.payment_proof_short_links (created_at desc);
