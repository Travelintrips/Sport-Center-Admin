import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Store = Pick<typeof db, "execute" | "transaction">;
const DEVICE = "TDBD234200545";
const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

/**
 * Close only unused direct Admin Lapangan visitor-card grants.
 * Never issue a device command or mark a card as physically returned.
 * A recent authenticated Group 2 snapshot is required: ambiguous machine
 * state, previously issued commands and card handover all fail closed.
 */
export async function expireUnusedAdminVisGrants(store: Store, now: Date, onlyPin?: string): Promise<number> {
  if (!Number.isFinite(now.getTime())) return 0;
  const wibDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const parts = Object.fromEntries(wibDate.map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", hour: "2-digit", hourCycle: "h23",
  }).format(now));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isInteger(hour)) return 0;

  const candidates = await store.execute(sql`
    SELECT a.access_id
    FROM sport_center.x904_nonmember_daily_access a
    JOIN sport_center.sport_bookings b ON b.id=a.booking_id
    WHERE a.device_serial=${DEVICE}
      AND a.identity_type='card'
      AND a.verification_state='pending' AND a.access_state='pending'
      AND a.activated_at IS NULL
      AND b.source='admin'
      AND b.booking_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (b.booking_date < ${today} OR (b.booking_date = ${today} AND ${hour} >= 23))
      AND (${onlyPin ?? null}::text IS NULL OR a.user_pin=${onlyPin ?? null})
    ORDER BY a.access_id LIMIT 25`);
  let expired = 0;
  for (const candidate of candidates.rows as any[]) {
    const updated = await store.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904212)`);
      const found = await tx.execute(sql`SELECT a.access_id,a.user_pin,a.device_uid,a.verified_name,a.identity_label,
          a.booking_id,b.booking_date
        FROM sport_center.x904_nonmember_daily_access a
        JOIN sport_center.sport_bookings b ON b.id=a.booking_id
        WHERE a.access_id=${Number(candidate.access_id)} AND a.device_serial=${DEVICE}
          AND a.identity_type='card' AND a.verification_state='pending'
          AND a.access_state='pending' AND a.activated_at IS NULL
          AND b.source='admin'
        FOR UPDATE OF a SKIP LOCKED`);
      if (found.rows.length !== 1) return false;
      const a = found.rows[0] as any;
      const date = String(a.booking_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !(date < today || (date === today && hour >= 23))) return false;
      const pin = String(a.user_pin);
      if (!/^[0-9]{1,8}$/.test(pin) ||
          (onlyPin !== undefined && pin !== onlyPin)) return false;

      // A card must have never been handed over, or issued any device command
      // through this paid grant. The latter prevents hiding delayed ACKs.
      const blockers = await tx.execute(sql`SELECT
        EXISTS(SELECT 1 FROM sport_center.x904_user_commands c
          WHERE c.device_serial=${DEVICE} AND (
            (c.user_pin=${pin} AND c.state IN ('queued','claimed')) OR
            (c.payload->>'accessId'=${String(a.access_id)}
              AND c.payload->>'source'='AUTO_NONMEMBER_GYM_12H'))) AS has_command,
        EXISTS(SELECT 1 FROM sport_center.gym_vis_card_reservations r
          WHERE r.booking_id=${Number(a.booking_id)}
            AND r.state IN ('reserved','collected')) AS has_handover,
        EXISTS(SELECT 1 FROM sport_center.gym_x904_member_mapping m
          WHERE m.device_serial=${DEVICE} AND m.user_pin=${pin}) AS member_owned,
        EXISTS(SELECT 1 FROM sport_center.x904_nonmember_daily_access other
          WHERE other.device_serial=${DEVICE} AND other.user_pin=${pin}
            AND other.access_id<>${Number(a.access_id)}
            AND other.access_state IN ('pending','active')) AS concurrent_grant`);
      const block = blockers.rows[0] as any;
      if (!block || block.has_command || block.has_handover || block.member_owned || block.concurrent_grant) return false;

      const inventory = await tx.execute(sql`SELECT 1
        FROM sport_center.gym_x904_lan_users
        WHERE device_serial=${DEVICE} AND user_pin=${pin}
          AND device_uid=${Number(a.device_uid)} AND device_role=0
          AND regexp_replace(upper(display_name),'[[:space:]]+','','g') =
              regexp_replace(upper(${String(a.identity_label)}::text),'[[:space:]]+','','g')`);
      if (inventory.rows.length !== 1) return false;

      const snapshot = await tx.execute(sql`SELECT observed_at,user_count,users
        FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=${DEVICE}
        ORDER BY snapshot_id DESC LIMIT 1`);
      if (snapshot.rows.length !== 1) return false;
      const s = snapshot.rows[0] as any;
      const observed = new Date(String(s.observed_at)).getTime();
      const users: any[] = Array.isArray(s.users) ? s.users : [];
      if (!Number.isFinite(observed) || observed > now.getTime() ||
          now.getTime()-observed > SNAPSHOT_MAX_AGE_MS ||
          users.length !== Number(s.user_count)) return false;
      const match = users.filter(user =>
        String(user.pin) === pin &&
        Number(user.role) === 0 && user.enabled === true &&
        Number(user.group) === 2 &&
        String(user.name ?? "").replace(/\s+/g, "").toUpperCase() ===
          String(a.identity_label).replace(/\s+/g, "").toUpperCase());
      if (match.length !== 1) return false;

      const result = await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
        SET access_state='expired'
        WHERE access_id=${Number(a.access_id)} AND verification_state='pending'
          AND access_state='pending' AND activated_at IS NULL
        RETURNING access_id`);
      return result.rows.length === 1;
    });
    if (updated) {
      expired++;
      console.info("[x904-admin-vis] unused pending grant expired after authenticated Group2 snapshot", {
        accessId: Number(candidate.access_id),
      });
    }
  }
  return expired;
}
