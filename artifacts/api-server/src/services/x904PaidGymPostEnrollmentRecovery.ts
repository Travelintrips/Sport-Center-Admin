import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { x904NonmemberOpeningHours } from "./x904NonmemberAccessPolicy";

type Store = Pick<typeof db, "transaction">;

/** Opt-in: reconcile an already staff-approved, paid public Gym booking
 * initially sent to VIS after its identity has since been enrolled on X904.
 * Never issue a door command, fabricate a physical card handover, or repay.
 * The existing worker still requires the authenticated Group 1 ACK. */
export async function recoverPaidGymPostEnrollment(
  store: Store = db, now = new Date(),
  actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY),
): Promise<number> {
  if (process.env.GYM_X904_POST_ENROLLMENT_RECOVERY_ENABLED !== "true" ||
      process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_MANUAL_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_USER_WRITE_ENABLED !== "true" ||
      process.env.GYM_X904_NONMEMBER_ONLY_PIN !== undefined ||
      !x904NonmemberOpeningHours(now) ||
      !Number.isSafeInteger(actor) || actor <= 0) return 0;
  return store.transaction(async tx => {
    // Existing physical VIS reservation mutex. Avoid race with admin handover.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(90400661)`);
    const created = await tx.execute(sql`
      WITH snap AS (
        SELECT observed_at,user_count,users
        FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial='TDBD234200545'
        ORDER BY snapshot_id DESC LIMIT 1
      ), eligible AS (
        SELECT b.id booking_id,p.id payment_id,p.confirmed_at,b.booking_date,
               u.user_pin,u.device_uid,u.display_name
        FROM sport_center.sport_bookings b
        JOIN sport_center.sport_payments p ON p.booking_id=b.id
        JOIN sport_center.gym_x904_lan_users u
          ON u.device_serial='TDBD234200545' AND u.device_role=0
          AND upper(regexp_replace(trim(u.display_name),'[[:space:]]+','','g')) =
              upper(regexp_replace(trim(b.customer_name),'[[:space:]]+','','g'))
        JOIN sport_center.x904_verified_nonmember_identities v
          ON v.device_serial=u.device_serial AND v.user_pin=u.user_pin
         AND v.device_uid=u.device_uid AND v.verification_state='verified'
         AND v.revoked_at IS NULL
         AND upper(regexp_replace(trim(v.display_name),'[[:space:]]+','','g')) =
             upper(regexp_replace(trim(u.display_name),'[[:space:]]+','','g'))
        CROSS JOIN snap
        WHERE b.facility_id=6 AND b.source='gym_public_guest'
          AND b.status::text='confirmed'
          AND b.booking_date::date=(${now}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
          AND b.membership_id IS NULL AND b.membership_payment_id IS NULL
          AND b.notes LIKE '%Kartu VIS001–VIS006 menunggu pilihan%'
          AND p.status::text='confirmed' AND p.confirmed_at IS NOT NULL
          AND p.confirmed_at<=${now} AND p.payment_type::text='full_payment'
          AND p.source_membership_payment_id IS NULL
          AND NULLIF(btrim(p.proof_url),'') IS NOT NULL
          AND p.amount>=COALESCE(b.grand_total,b.total_price)
          AND COALESCE(b.grand_total,b.total_price)>0
          AND (SELECT count(*) FROM sport_center.sport_payments confirmed
               WHERE confirmed.booking_id=b.id AND confirmed.status::text='confirmed')=1
          -- The existing one Admin payment approval must already be audited.
          AND EXISTS (SELECT 1 FROM sport_center.audit_logs al
            WHERE al.action='FINAL_PAYMENT_APPROVED' AND al.entity='payment'
              AND al.entity_id=p.id)
          AND NOT EXISTS (SELECT 1 FROM sport_center.gym_vis_card_reservations r
            WHERE r.booking_id=b.id)
          AND NOT EXISTS (SELECT 1 FROM sport_center.x904_nonmember_daily_access a
            WHERE a.booking_id=b.id OR a.payment_id=p.id)
          AND NOT EXISTS (SELECT 1 FROM sport_center.gym_x904_member_mapping m
            WHERE m.device_serial=u.device_serial AND m.user_pin=u.user_pin)
          AND NOT EXISTS (SELECT 1 FROM sport_center.x904_nonmember_daily_access a
            WHERE a.device_serial=u.device_serial AND a.user_pin=u.user_pin
              AND a.access_state IN ('pending','active','review_required'))
          AND u.user_pin NOT IN ('12','79','237')
          AND u.user_pin ~ '^[0-9]{1,8}$' AND u.device_uid>0
          AND (SELECT count(*) FROM sport_center.gym_x904_lan_users m
            WHERE m.device_serial=u.device_serial AND m.device_role=0 AND
              upper(regexp_replace(trim(m.display_name),'[[:space:]]+','','g')) =
              upper(regexp_replace(trim(b.customer_name),'[[:space:]]+','','g')))=1
          -- Snapshot is complete, fresh, and proves precisely this PIN is Group 2.
          AND snap.observed_at<=${now}
          AND snap.observed_at>=${now}::timestamptz-interval '5 minutes'
          AND jsonb_typeof(snap.users)='array'
          AND jsonb_array_length(snap.users)=snap.user_count
          AND (SELECT count(*) FROM jsonb_array_elements(snap.users) su
            WHERE su->>'pin'=u.user_pin AND su->>'role'='0'
              AND su->>'group'='2' AND su->>'enabled'='true'
              AND upper(regexp_replace(trim(su->>'name'),'[[:space:]]+','','g')) =
                  upper(regexp_replace(trim(u.display_name),'[[:space:]]+','','g')))=1
        ORDER BY b.id LIMIT 6 FOR UPDATE OF b,p
      )
      INSERT INTO sport_center.x904_nonmember_daily_access
        (device_serial,identity_type,identity_label,user_pin,device_uid,
         verified_name,booking_id,payment_id,confirmed_at,expires_at,
         verification_state,access_state)
      SELECT 'TDBD234200545','pin','PIN:'||e.user_pin,e.user_pin,e.device_uid,
        e.display_name,e.booking_id,e.payment_id,e.confirmed_at,
        ((e.booking_date::date+time '23:00') AT TIME ZONE 'Asia/Jakarta'),
        'pending','pending'
      FROM eligible e
      ON CONFLICT DO NOTHING
      RETURNING access_id,booking_id,payment_id,user_pin,device_uid
    `);
    let authorized = 0;
    for (const raw of created.rows as any[]) {
      const accessId=Number(raw.access_id),bookingId=Number(raw.booking_id);
      const paymentId=Number(raw.payment_id),pin=String(raw.user_pin);
      const uid=Number(raw.device_uid);
      const changed = await tx.execute(sql`
        UPDATE sport_center.x904_nonmember_daily_access
        SET verification_state='verified'
        WHERE access_id=${accessId} AND booking_id=${bookingId}
          AND payment_id=${paymentId} AND user_pin=${pin}
          AND device_uid=${uid} AND verification_state='pending'
          AND access_state='pending' AND activated_at IS NULL
        RETURNING access_id
      `);
      if (changed.rows.length!==1)
        throw new Error("GYM_POST_ENROLLMENT_GRANT_AUTHORIZATION_FAILED");
      await tx.execute(sql`
        INSERT INTO sport_center.audit_logs
          (user_id,user_name,user_role,action,entity,entity_id,"before","after")
        VALUES (${actor},'X904 AUTOMATION SERVICE','staff',
          'x904_guest_pin_post_enrollment_auto_recovered','booking',${bookingId},
          '{"verificationState":"pending","accessState":"pending"}'::jsonb,
          ${JSON.stringify({accessId,bookingId,paymentId,basis:"existing_staff_approved_payment_verified_registry_fresh_group2"})}::jsonb)
      `);
      authorized++;
    }
    return authorized;
  });
}
