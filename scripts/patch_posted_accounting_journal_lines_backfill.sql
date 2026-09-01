-- Explicit, transaction-local escape hatch for completing legacy orphan
-- journal headers. It permits INSERT only; posted lines remain immutable for
-- UPDATE and DELETE, and the setting is never enabled by default.
CREATE OR REPLACE FUNCTION sport_center.guard_posted_accounting_journal_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'sport_center'
AS $function$
DECLARE
  v_journal_id integer;
  v_status text;
BEGIN
  v_journal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_id ELSE NEW.journal_id END;

  SELECT status
    INTO v_status
    FROM sport_center.accounting_journals
   WHERE id = v_journal_id;

  IF v_status IN ('posted', 'reversed') THEN
    IF TG_OP = 'INSERT'
       AND v_status = 'posted'
       AND COALESCE(
         current_setting(
           'sport_center.allow_posted_accounting_journal_lines_backfill',
           true
         ),
         'off'
       ) = 'on' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'POSTED_ACCOUNTING_JOURNAL_LINES_IMMUTABLE: %',
      v_journal_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;