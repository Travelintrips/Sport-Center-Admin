-- Align existing LAN first-scan auto check-in with the seven-day paid-membership
-- grace policy already used by the entitlement scheduler.
-- The caller still requires a verified identity and ordinary device role.
-- The existing PL/pgSQL function still serializes per-member and inserts at most
-- one attendance/day. No device commands or accounting rows are created.
-- A grace check-in requires one confirmed positive payment covering the exact
-- membership expiration date. A stale unrelated payment must not authorize it.
DO $$
DECLARE definition text; updated text;
 old_guard text := $guard$if not exists (
   select 1 from sport_center.sport_membership_payments p
   where p.membership_id=v_member.membership_id and p.status='confirmed'
     and p.period_start<=v_date::text and p.period_end>=v_date::text
 ) then return 'skip_unpaid'; end if;$guard$;
 new_guard text := $guard$if not exists (
   select 1 from sport_center.sport_membership_payments p
   where p.membership_id=v_member.membership_id and p.status='confirmed' and p.amount>0
     and (
       (p.period_start<=v_date::text and p.period_end>=v_date::text)
       or
       (v_member.start_date::date<=v_date
         and v_member.end_date::date<v_date
         and v_date<=v_member.end_date::date+7
         and p.period_start<=v_member.end_date
         and p.period_end>=v_member.end_date)
     )
 ) then return 'skip_unpaid'; end if;$guard$;
BEGIN
 definition := pg_get_functiondef('sport_center.x904_apply_first_daily_checkin(text)'::regprocedure);
 IF position(new_guard in definition)>0 THEN RETURN; END IF;
 IF position(old_guard in definition)=0 THEN
   RAISE EXCEPTION 'X904_LAN_GUARD_SOURCE_CHANGED_ABORT';
 END IF;
 IF position('pg_advisory_xact_lock(904,v_member.membership_id)' in definition)=0
    OR position('on conflict do nothing returning id into v_checkin_id' in definition)=0 THEN
   RAISE EXCEPTION 'X904_DUPLICATE_PROTECTION_NOT_FOUND_ABORT';
 END IF;
 updated := replace(definition, old_guard, new_guard);
 IF updated=definition THEN RAISE EXCEPTION 'X904_LAN_GUARD_NOT_PATCHED'; END IF;
 EXECUTE updated;
END $$;
