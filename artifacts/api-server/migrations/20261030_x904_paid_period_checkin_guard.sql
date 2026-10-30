-- Match check-in eligibility to the confirmed payment covering the scan date.
-- Renewals may advance sport_memberships.start_date before the prior paid
-- period ends; current membership dates must not erase already-paid visits.
-- Preserve the existing payment, role, mapping and first-scan guards.
DO $$
DECLARE definition text; updated text;
BEGIN
 definition := pg_get_functiondef('sport_center.x904_apply_first_daily_checkin(text)'::regprocedure);
 IF position('p.period_start<=v_date::text and p.period_end>=v_date::text' in definition)=0 THEN
   RAISE EXCEPTION 'X904_CONFIRMED_PAYMENT_COVERAGE_GUARD_MISSING';
 END IF;
 updated := replace(definition,
   'or v_date < v_member.start_date::date or v_date > v_member.end_date::date', '');
 IF position('perform 1 from sport_center.sport_memberships where id=v_member.membership_id for update;' in updated)=0 THEN
   updated := replace(updated,
     'perform pg_advisory_xact_lock(904,v_member.membership_id);',
     'perform 1 from sport_center.sport_memberships where id=v_member.membership_id for update;'
     || chr(10) || ' perform pg_advisory_xact_lock(904,v_member.membership_id);');
 END IF;
 IF position('perform 1 from sport_center.sport_memberships where id=v_member.membership_id for update;' in updated)=0 THEN
   RAISE EXCEPTION 'X904_MANUAL_AND_AUTO_SERIALIZATION_GUARD_MISSING';
 END IF;
 IF updated <> definition THEN EXECUTE updated; END IF;
END $$;
