import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type GymGuestIdentityRoute = "registered" | "visitor_card" | "staff_review";
export type GymGuestIdentityMatch = {
  route: GymGuestIdentityRoute;
  userPin: string | null;
  deviceUid: number | null;
  displayName: string | null;
  // Informational only: entered PIN matches a unique nonmember inventory row.
  inventoryPinMatch?: boolean | null;
};

const DEVICE = "TDBD234200545";
const VIS_PINS = new Set(["78", "90", "13", "17", "11", "15"]);
const RESERVED_PINS = new Set(["12", "79", "237"]);

export function normalizeGymGuestName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID");
}

/**
 * Read-only identity routing, never a door authorization.
 * Registered = one uniquely matched, nonmember, operator-verified machine identity.
 * Visitor = name does not exist in device inventory: staff must assign an available VIS.
 * Staff review = existing but ambiguous/privileged/member/unverified identity.
 * Do not return a PIN from the public route; only booking/admin audit may store it.
 */
export async function resolveGymGuestName(rawName: string, submittedPin = ""): Promise<GymGuestIdentityMatch> {
  const name = normalizeGymGuestName(rawName);
  if (!name || name.length > 100) return { route: "staff_review", userPin: null, deviceUid: null, displayName: null };
  const matched = await db.execute(sql`SELECT user_pin,device_uid,display_name,device_role
    FROM sport_center.gym_x904_lan_users
    WHERE device_serial=${DEVICE}
      AND upper(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g'))=${name}
    LIMIT 3`);
  if (matched.rows.length === 0) return { route: "visitor_card", userPin: null, deviceUid: null, displayName: null };
  if (matched.rows.length !== 1) return { route: "staff_review", userPin: null, deviceUid: null, displayName: null };
  const entry = matched.rows[0] as any;
  const pin = String(entry.user_pin);
  const uid = Number(entry.device_uid);
  const visibleName = String(entry.display_name ?? "").trim();
  if (!/^[0-9]{1,8}$/.test(pin) || VIS_PINS.has(pin) || RESERVED_PINS.has(pin) ||
      !Number.isSafeInteger(uid) || uid <= 0 || Number(entry.device_role) !== 0 ||
      normalizeGymGuestName(visibleName) !== name) {
    return { route: "staff_review", userPin: null, deviceUid: null, displayName: null };
  }
  const ownership = await db.execute(sql`SELECT 1 FROM sport_center.gym_x904_member_mapping
    WHERE device_serial=${DEVICE} AND user_pin=${pin} LIMIT 1`);
  if (ownership.rows.length > 0) return { route: "staff_review", userPin: null, deviceUid: null, displayName: null };
  // An inventory match is NOT operator approval or a door entitlement.
  const inventoryPinMatch = submittedPin ? submittedPin === pin : null;
  const approved = await db.execute(sql`SELECT 1 FROM sport_center.x904_verified_nonmember_identities
    WHERE device_serial=${DEVICE} AND user_pin=${pin} AND device_uid=${uid}
      AND upper(regexp_replace(trim(display_name), '[[:space:]]+', ' ', 'g'))=${name}
      AND verification_state='verified' AND revoked_at IS NULL LIMIT 1`);
  if (approved.rows.length !== 1) return {
    route: "staff_review", userPin: null, deviceUid: null, displayName: null, inventoryPinMatch,
  };
  return { route: "registered", userPin: pin, deviceUid: uid, displayName: visibleName, inventoryPinMatch };
}
