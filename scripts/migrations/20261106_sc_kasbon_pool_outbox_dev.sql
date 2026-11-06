-- DEV-only until the sheet writer and read-back are verified.
-- Append-only outbox: transactions are never lost when Google Sheets is unavailable.
CREATE TABLE IF NOT EXISTS sport_center.sc_kasbon_pool_sync_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kasbon_id integer NOT NULL,
 employee_id text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('created','updated','deleted')),
 old_record jsonb,
 new_record jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','synced','needs_review')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sc_kasbon_pool_sync_queue_idx ON sport_center.sc_kasbon_pool_sync_events(status, id);
CREATE INDEX IF NOT EXISTS sc_kasbon_pool_sync_source_idx ON sport_center.sc_kasbon_pool_sync_events(kasbon_id,id DESC);

-- Keep existing Kasbon CRUD unchanged: enqueue in same database transaction.
CREATE OR REPLACE FUNCTION sport_center.enqueue_sc_kasbon_pool_sync()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, sport_center AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  INSERT INTO sport_center.sc_kasbon_pool_sync_events(kasbon_id,employee_id,event_type,new_record)
  VALUES (NEW.id,NEW.employee_id,'created',to_jsonb(NEW));
  RETURN NEW;
 ELSIF TG_OP = 'UPDATE' THEN
  IF ROW(OLD.employee_id,OLD.kasbon_date,OLD.amount,OLD.notes,OLD.proof_url)
     IS DISTINCT FROM ROW(NEW.employee_id,NEW.kasbon_date,NEW.amount,NEW.notes,NEW.proof_url) THEN
    INSERT INTO sport_center.sc_kasbon_pool_sync_events(kasbon_id,employee_id,event_type,old_record,new_record)
    VALUES (NEW.id,NEW.employee_id,'updated',to_jsonb(OLD),to_jsonb(NEW));
  END IF;
  RETURN NEW;
 ELSIF TG_OP = 'DELETE' THEN
  INSERT INTO sport_center.sc_kasbon_pool_sync_events(kasbon_id,employee_id,event_type,old_record)
  VALUES (OLD.id,OLD.employee_id,'deleted',to_jsonb(OLD));
  RETURN OLD;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sc_kasbon_pool_sync_outbox_trg ON sport_center.sc_employee_kasbon;
CREATE TRIGGER sc_kasbon_pool_sync_outbox_trg
AFTER INSERT OR UPDATE OR DELETE ON sport_center.sc_employee_kasbon
FOR EACH ROW EXECUTE FUNCTION sport_center.enqueue_sc_kasbon_pool_sync();

-- No grants to anon or authenticated. Internal backend only.

CREATE TABLE IF NOT EXISTS sport_center.sc_kasbon_pool_sync_ledger (
 kasbon_id integer PRIMARY KEY,
 employee_id text NOT NULL,
 sheet_cell text NOT NULL,
 spreadsheet_id text NOT NULL,
 amount numeric(15,2) NOT NULL CHECK(amount>0),
 source_event_id bigint NOT NULL UNIQUE REFERENCES sport_center.sc_kasbon_pool_sync_events(id),
 synced_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(spreadsheet_id,sheet_cell)
);
