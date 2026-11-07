import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type GymGuestIdentityRoute = "registered" | "expired_member" | "recognized_review" | "visitor_card" | "staff_review";
export type GymGuestIdentityMatch = {
  route: GymGuestIdentityRoute;
  userPin: string | null;
  deviceUid: number | null;
  displayName: string | null;
  inventoryPinMatch?: boolean | null;
};

const DEVICE = "TDBD234200545";
const VIS_PINS = new Set(["78", "90", "13", "17", "11", "15"]);
const RESERVED_PINS = new Set(["12", "79", "237"]);

export function normalizeGymGuestName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID");
}

/**
 * Read-only recognition of every X904 machine name, not a door grant.
 * - Only a currently active Gym membership is excluded from name highlighting.
 * - Other existing machine names can be recognized, regardless of role/PIN.
 * - Unknown ownership, special PIN, old membership, and ambiguous names
 *   never authorize machine access, and never return their stored PIN/UID.
 */
export async function resolveGymGuestName(rawName: string, submittedPin = ""): Promise<GymGuestIdentityMatch> {
  const name = normalizeGymGuestName(rawName);
  const review = (): GymGuestIdentityMatch => ({
    route: "staff_review", userPin: null, deviceUid: null, displayName: null,
  });
  const recognized = (): GymGuestIdentityMatch => ({
    route: "recognized_review", userPin: null, deviceUid: null, displayName: null,
  });

  if (!name || name.length > 100) return review();
  const matched = await db.execute(sql`SELECT user_pin,device_uid,display_name,device_role
    FROM sport_center.gym_x904_lan_users
    WHERE device_serial=${DEVICE}
      AND upper(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g'))=${name}
    LIMIT 3`);
  if (!matched.rows.length) {
    return { route: "visitor_card", userPin: null, deviceUid: null, displayName: null };
  }

  // Check every machine entry with this name, not just the first three:
  // a duplicate nonmember must not override a currently active member.
  const todayWib = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const active = await db.execute(sql`SELECT 1
    FROM sport_center.gym_x904_lan_users u
    JOIN sport_center.gym_x904_member_mapping mp
      ON mp.device_serial=u.device_serial AND mp.user_pin=u.user_pin
    JOIN sport_center.sport_memberships m ON m.id=mp.membership_id
    WHERE u.device_serial=${DEVICE}
      AND upper(regexp_replace(trim(u.display_name), '[[:space:]]+', ' ', 'g'))=${name}
      AND m.status::text='active'
      AND m.start_date <= ${todayWib}::date
      AND m.end_date >= ${todayWib}::date
    LIMIT 1`);
  if (active.rows.length) return review();

  // Multiple matching PINs remain detectable, never automatically linked.
  if (matched.rows.length !== 1) return recognized();
  const entry = matched.rows[0] as any;
  const pin = String(entry.user_pin ?? "");
  const uid = Number(entry.device_uid);
  const visibleName = String(entry.display_name ?? "").trim();
  if (!/^[0-9]{1,8}$/.test(pin) || normalizeGymGuestName(visibleName) !== name) return recognized();

  const ownership = await db.execute(sql`SELECT mp.membership_id,mp.status AS mapping_status,
      m.status::text AS membership_status,m.end_date
    FROM sport_center.gym_x904_member_mapping mp
    JOIN sport_center.sport_memberships m ON m.id=mp.membership_id
    WHERE mp.device_serial=${DEVICE} AND mp.user_pin=${pin} LIMIT 3`);

  // Expired, suspended, and future-starting memberships may purchase day tickets,
  // but their former/current member PIN must never be borrowed as a guest grant.
  if (ownership.rows.length) {
    if (ownership.rows.length === 1 && String((ownership.rows[0] as any).membership_status) === "expired") {
      return { route: "expired_member", userPin: null, deviceUid: null, displayName: null };
    }
    return recognized();
  }

  // Include staff and all special PINs in recognition only: no door entitlement.
  if (!Number.isSafeInteger(uid) || uid <= 0 || Number(entry.device_role) !== 0 ||
      VIS_PINS.has(pin) || RESERVED_PINS.has(pin)) return recognized();

  const approved = await db.execute(sql`SELECT 1 FROM sport_center.x904_verified_nonmember_identities
    WHERE device_serial=${DEVICE} AND user_pin=${pin} AND device_uid=${uid}
      AND upper(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g'))=${name}
      AND verification_state='verified' AND revoked_at IS NULL LIMIT 1`);
  if (approved.rows.length !== 1) return recognized();
  return { route: "registered", userPin: pin, deviceUid: uid, displayName: visibleName,
    inventoryPinMatch: submittedPin ? submittedPin === pin : null };
}
