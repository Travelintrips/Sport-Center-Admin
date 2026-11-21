import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Store = Pick<typeof db, "transaction">;

/**
 * Close an UNUSED and expired VIS reservation, NOT a physically lent card.
 *
 * State 'cancelled' is already in the reservation schema; the BOOKING and
 * PAYMENT remain unchanged. 'returned' is reserved for an actual physical
 * return witnessed by staff.
 *
 * Fail closed on any activation, handover, scan, stale device/connector proof,
 * contested PIN, or queued command. Never touch the device or invent an ACK.
 */
export async function releaseExpiredUnusedVisReservations(store: Store = db): Promise<number> {
  const result = await store.transaction(async tx => {
    // Share the same serialisation lock as card assignment and handover.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(90400661)`);
    const eligible = await tx.execute(sql`
      SELECT r.id,r.booking_id,r.card_code
      FROM sport_center.gym_vis_card_reservations r
      JOIN sport_center.sport_bookings b ON b.id=r.booking_id
      JOIN sport_center.x904_nonmember_daily_access a
        ON a.booking_id=b.id AND a.payment_id=r.payment_id
        AND a.device_serial=r.device_serial AND a.user_pin=r.user_pin
        AND a.device_uid=r.device_uid AND a.identity_type='card'
      JOIN sport_center.gym_x904_lan_users machine
        ON machine.device_serial=r.device_serial
        AND machine.user_pin=r.user_pin AND machine.device_uid=r.device_uid
        AND machine.device_role=0
      JOIN LATERAL (
        SELECT observed_at,user_count,users
        FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=r.device_serial
        ORDER BY observed_at DESC,snapshot_id DESC LIMIT 1
      ) s ON true
      JOIN sport_center.gym_x904_connector_heartbeats hb
        ON hb.device_serial=r.device_serial
      WHERE r.device_serial='TDBD234200545'
        AND r.state='reserved' AND r.collected_at IS NULL
        AND r.returned_at IS NULL
        AND ((b.booking_date::date + time '23:00') AT TIME ZONE 'Asia/Jakarta')<=now()
        AND a.access_state='expired' AND a.activated_at IS NULL
        AND s.observed_at>r.reserved_at
        AND s.observed_at>=now()-interval '5 minutes'
        AND hb.last_seen>=now()-interval '5 minutes'
        AND hb.read_authenticated=true
        AND jsonb_typeof(s.users)='array'
        AND jsonb_array_length(s.users)=s.user_count
        AND (SELECT count(*) FROM jsonb_array_elements(s.users) u
             WHERE u->>'pin'=r.user_pin)=1
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.users) u
          WHERE u->>'pin'=r.user_pin AND u->>'group'='2'
            AND u->>'role'='0' AND u->>'enabled'='true'
            AND u->>'name'=machine.display_name)
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.gym_x904_lan_logs l
          WHERE l.user_pin=r.user_pin AND l.received_at>=r.reserved_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.x904_user_commands c
          WHERE c.device_serial=r.device_serial AND c.user_pin=r.user_pin
            AND c.created_at>=r.reserved_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.x904_user_commands c
          WHERE c.device_serial=r.device_serial AND c.user_pin=r.user_pin
            AND c.created_at>s.observed_at
        )
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.x904_nonmember_daily_access another
          WHERE another.device_serial=r.device_serial AND another.user_pin=r.user_pin
            AND another.access_id<>a.access_id
            AND another.access_state IN ('pending','active','review_required')
        )
        AND NOT EXISTS (
          SELECT 1 FROM sport_center.gym_x904_member_mapping m
          WHERE m.device_serial=r.device_serial AND m.user_pin=r.user_pin
        )
      ORDER BY r.reserved_at,r.id LIMIT 6 FOR UPDATE OF r SKIP LOCKED
    `);
    let released = 0;
    for (const item of eligible.rows as Array<{id: number;booking_id: number;card_code:string}>) {
      const changed = await tx.execute(sql`
        UPDATE sport_center.gym_vis_card_reservations
        SET state='cancelled'
        WHERE id=${Number(item.id)} AND state='reserved'
          AND collected_at IS NULL AND returned_at IS NULL
        RETURNING id
      `);
      if (changed.rows.length !== 1) continue;
      await tx.execute(sql`
        INSERT INTO sport_center.audit_logs
          (action,entity,entity_id,"before","after",user_name,user_role)
        VALUES (
          'gym_vis_unused_expired_reservation_auto_released',
          'booking',${Number(item.booking_id)},
          '{"reservationState":"reserved"}'::jsonb,
          ${JSON.stringify({reservationState:"cancelled",cardCode:String(item.card_code),
            reason:"unused_no_activation_no_scan_fresh_group2",
            physicalReturnRecorded:false})}::jsonb,
          'X904 AUTOMATION SERVICE','system'
        )
      `);
      released++;
    }
    return released;
  });
  return result;
}
