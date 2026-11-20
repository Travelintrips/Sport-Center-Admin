-- Synthetic two-operator certification fixture. Never execute on CST-DEV or PROD.
CREATE ROLE cert_operator_a NOLOGIN;
CREATE ROLE cert_operator_b NOLOGIN;
CREATE SCHEMA cert_multisite;
CREATE TABLE cert_multisite.bookings (
  id integer PRIMARY KEY,
  operator_id integer NOT NULL CHECK (operator_id IN (1,2)),
  order_number text NOT NULL,
  UNIQUE(id, operator_id),
  UNIQUE(operator_id, order_number)
);
CREATE TABLE cert_multisite.payments (
  id integer PRIMARY KEY,
  operator_id integer NOT NULL CHECK (operator_id IN (1,2)),
  booking_id integer NOT NULL,
  amount numeric(12,2) NOT NULL,
  UNIQUE(id,operator_id),
  FOREIGN KEY (booking_id, operator_id) REFERENCES cert_multisite.bookings(id, operator_id)
);
CREATE TABLE cert_multisite.devices (
  serial text PRIMARY KEY,
  operator_id integer NOT NULL CHECK (operator_id IN (1,2)),
  device_group integer NOT NULL CHECK (device_group IN (1,2)),
  UNIQUE(serial,operator_id)
);
CREATE TABLE cert_multisite.device_commands (
  id integer PRIMARY KEY,
  operator_id integer NOT NULL CHECK (operator_id IN (1,2)),
  serial text NOT NULL,
  action text NOT NULL CHECK (action IN ('ACTIVATE_USER','SUSPEND_USER')),
  state text NOT NULL DEFAULT 'queued',
  FOREIGN KEY (serial,operator_id) REFERENCES cert_multisite.devices(serial,operator_id)
);
CREATE TABLE cert_multisite.journal (
  id integer PRIMARY KEY,
  operator_id integer NOT NULL CHECK (operator_id IN (1,2)),
  event_key text NOT NULL,
  amount numeric(12,2) NOT NULL,
  UNIQUE(operator_id,event_key)
);
INSERT INTO cert_multisite.bookings VALUES (101,1,'TEST-A-001'),(201,2,'TEST-B-001');
INSERT INTO cert_multisite.payments VALUES (501,1,101,100000),(601,2,201,200000);
INSERT INTO cert_multisite.devices VALUES ('CERT-A-X904',1,2),('CERT-B-X904',2,2);
INSERT INTO cert_multisite.device_commands VALUES (701,1,'CERT-A-X904','ACTIVATE_USER','queued'),(801,2,'CERT-B-X904','ACTIVATE_USER','queued');
INSERT INTO cert_multisite.journal VALUES (901,1,'cert-payment-501',100000),(902,2,'cert-payment-601',200000);
GRANT USAGE ON SCHEMA cert_multisite TO cert_operator_a,cert_operator_b;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA cert_multisite TO cert_operator_a,cert_operator_b;
DO $$
DECLARE t text;
BEGIN
 FOR t IN SELECT unnest(ARRAY['bookings','payments','devices','device_commands','journal']) LOOP
  EXECUTE format('ALTER TABLE cert_multisite.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cert_multisite.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format($p$CREATE POLICY cert_operator_scope ON cert_multisite.%I FOR ALL TO cert_operator_a,cert_operator_b
    USING (operator_id = CASE current_user WHEN 'cert_operator_a' THEN 1 WHEN 'cert_operator_b' THEN 2 ELSE -1 END)
    WITH CHECK (operator_id = CASE current_user WHEN 'cert_operator_a' THEN 1 WHEN 'cert_operator_b' THEN 2 ELSE -1 END)$p$,t);
 END LOOP;
END $$;
