import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Repair late LAN ingestion or a membership renewal that replaced the current
 * membership dates. Strictly bounded to today/yesterday, verified identities,
 * confirmed paid coverage and existing device logs. Never invent scan events.
 * The canonical SQL function owns serialization and exactly-once attendance.
 */
export async function reconcileX904MissedPaidCheckins(): Promise<void> {
  const candidates = await db.execute(sql`
    SELECT DISTINCT ON (l.user_pin, left(l.device_time,10)) l.event_id
    FROM sport_center.gym_x904_lan_logs l
    JOIN sport_center.gym_x904_member_mapping mp
      ON mp.device_serial=l.device_serial AND mp.user_pin=l.user_pin AND mp.status='verified'
    JOIN sport_center.sport_memberships m ON m.id=mp.membership_id AND m.status='active'
    JOIN sport_center.gym_x904_lan_users u
      ON u.device_serial=l.device_serial AND u.user_pin=l.user_pin AND u.device_role=0
    WHERE l.device_serial='TDBD234200545'
      AND left(l.device_time,10) IN (
        (now() AT TIME ZONE 'Asia/Jakarta')::date::text,
        ((now() AT TIME ZONE 'Asia/Jakarta')::date-1)::text)
      AND EXISTS (SELECT 1 FROM sport_center.sport_membership_payments p
        WHERE p.membership_id=m.id AND p.status='confirmed' AND p.amount>0
          AND p.period_start<=left(l.device_time,10)
          AND p.period_end>=left(l.device_time,10))
      AND NOT EXISTS (SELECT 1 FROM sport_center.gym_checkins c
        WHERE c.membership_id=m.id AND c.checkin_date=left(l.device_time,10)::date)
    ORDER BY l.user_pin,left(l.device_time,10),l.device_time,l.event_index
    LIMIT 30`);
  for (const row of candidates.rows) {
    const eventId=String(row.event_id);
    const result=await db.execute(sql`SELECT sport_center.x904_apply_first_daily_checkin(${eventId}) as result`);
    const outcome=String(result.rows[0]?.result??'');
    if (outcome === 'error_nonblocking') logger.error({eventId}, '[x904] auto checkin reconciliation error');
  }
}
