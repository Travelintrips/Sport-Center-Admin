-- Paylabs Payment Gateway settings table
CREATE TABLE IF NOT EXISTS sport_center.paylabs_settings (
  id                     SERIAL PRIMARY KEY,
  title                  TEXT    NOT NULL DEFAULT 'Online Payment (Bank Transfer, Virtual Account, QRIS)',
  description            TEXT    NOT NULL DEFAULT '',
  send_invoice           BOOLEAN NOT NULL DEFAULT TRUE,
  charge_customer        BOOLEAN NOT NULL DEFAULT FALSE,
  new_order_status       TEXT    NOT NULL DEFAULT 'completed',
  debug_mode             BOOLEAN NOT NULL DEFAULT FALSE,
  sandbox_mode           BOOLEAN NOT NULL DEFAULT TRUE,
  store_id               TEXT    NOT NULL DEFAULT '',
  sandbox_public_key     TEXT    NOT NULL DEFAULT '',
  sandbox_private_key    TEXT    NOT NULL DEFAULT '',
  sandbox_merchant_id    TEXT    NOT NULL DEFAULT '',
  prod_public_key        TEXT    NOT NULL DEFAULT '',
  prod_private_key       TEXT    NOT NULL DEFAULT '',
  prod_merchant_id       TEXT    NOT NULL DEFAULT '',
  payment_methods_config JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
