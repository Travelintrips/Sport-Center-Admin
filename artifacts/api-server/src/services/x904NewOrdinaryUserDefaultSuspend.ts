import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isX904AutoSuspendExempt } from "./x904NonmemberAccessPolicy";
import { x904AutomaticCommandKey } from "./x904AutomationDecision";

const DEVICE = "TDBD234200545";
const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
type Store = Pick<typeof db, "execute" | "transaction">;

type SnapshotUser = {
  pin?: unknown;
  name?: unknown;
  role?: unknown;
  group?: unknown;
  enabled?: unknown;
};

/**
 * This is a compensating safety net for a new on-device enrollment, NOT a
 * substitute for registering the user in suspended Group 2 on the device.
 *
 * An explicit fresh baseline prevents scanning/suspending existing inventory.
 * A previously absent PIN must first appear in a complete, fresh snapshot.
 * A repeated historical PIN or any member/paid access is never eligible.
 */
export function isNewOrdinaryX904Candidate(
  user: SnapshotUser,
  previousPins: ReadonlySet<string>,
): boolean {
  const pin = String(user.pin ?? "");
  return /^[0-9]{1,8}$/.test(pin) &&
    !previousPins.has(pin) &&
    Number(user.role) === 0 &&
    !isX904AutoSuspendExempt(pin, Number(user.role)) &&
    user.enabled === true &&
    Number(user.group) === 1 &&
    String(user.name ?? "").trim().length >= 2;
}

export async function processX904NewOrdinaryUserDefaultSuspend(
  store: Store = db,
  now = new Date(),
): Promise<void> {
  // New feature explicitly off by default. Never mutate live machine from a
  // code deployment alone; require all existing access and write gates.
  if (process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED !== "true" ||
      process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_MANUAL_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return;

  const baselineRaw = process.env.GYM_X904_NEW_USER_BASELINE_AT ?? "";
  const baseline = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(baselineRaw)
    ? new Date(baselineRaw).getTime()
    : NaN;
  const actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  if (!Number.isFinite(baseline) || baseline > now.getTime() ||
      !Number.isSafeInteger(actor) || actor <= 0) return;

  const identity = await store.execute(sql`SELECT 1 FROM sport_center.users
    WHERE id=${actor} AND name='X904 AUTOMATION SERVICE'
      AND registration_source='system_x904_automation'
      AND account_status='inactive' AND email IS NULL AND password_hash IS NULL`);
  if (identity.rows.length !== 1) return;

  const snapshots = await store.execute(sql`SELECT snapshot_id, observed_at, user_count, users
    FROM sport_center.gym_x904_access_snapshots
    WHERE device_serial=${DEVICE} AND observed_at >= ${new Date(baseline)}
    ORDER BY snapshot_id DESC LIMIT 2`);
  if (snapshots.rows.length !== 2) return;
  const [latest, previous] = snapshots.rows as any[];
  const latestTime = new Date(String(latest.observed_at)).getTime();
  const previousTime = new Date(String(previous.observed_at)).getTime();
  if (!Number.isFinite(latestTime) || !Number.isFinite(previousTime) ||
      previousTime >= latestTime || latestTime > now.getTime() ||
      now.getTime() - latestTime > SNAPSHOT_MAX_AGE_MS) return;
  const currentUsers: SnapshotUser[] = Array.isArray(latest.users) ? latest.users : [];
  const priorUsers: SnapshotUser[] = Array.isArray(previous.users) ? previous.users : [];
  if (currentUsers.length !== Number(latest.user_count) ||
      priorUsers.length !== Number(previous.user_count) ||
      currentUsers.length < priorUsers.length) return;
  const previousPins = new Set(priorUsers.map(u => String(u.pin ?? "")));
  const newCandidates = currentUsers.filter(u => isNewOrdinaryX904Candidate(u, previousPins));
  if (!newCandidates.length) return;

  for (const candidate of newCandidates) {
    const pin = String(candidate.pin);
    const name = String(candidate.name).trim().replace(/\s+/g, " ");
    const onlyPin = process.env.GYM_X904_NEW_USER_ONLY_PIN;
    if (onlyPin && pin !== onlyPin) continue;
    await store.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904215)`);
      // A second snapshot refresh, claim or registration may have happened.
      const check = await tx.execute(sql`SELECT snapshot_id,observed_at,user_count,users
        FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=${DEVICE} ORDER BY snapshot_id DESC LIMIT 2`);
      if (check.rows.length !== 2 ||
          Number(check.rows[0].snapshot_id) !== Number(latest.snapshot_id) ||
          Number(check.rows[1].snapshot_id) !== Number(previous.snapshot_id)) return;
      const inventory = await tx.execute(sql`SELECT device_uid,display_name,device_role
        FROM sport_center.gym_x904_lan_users
        WHERE device_serial=${DEVICE} AND user_pin=${pin}`);
      if (inventory.rows.length !== 1) return;
      const saved = inventory.rows[0] as any;
      const uid = Number(saved.device_uid);
      if (!Number.isSafeInteger(uid) || uid <= 0 ||
          Number(saved.device_role) !== 0 ||
          String(saved.display_name).trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") !==
            name.toLocaleUpperCase("id-ID")) return;

      // A historically used/registered PIN is not a truly new ordinary user.
      // Stop instead of resetting a repurposed, member or privileged identity.
      const ownership = await tx.execute(sql`SELECT 1 FROM sport_center.gym_x904_member_mapping
        WHERE device_serial=${DEVICE} AND user_pin=${pin} LIMIT 1`);
      if (ownership.rows.length) return;
      const grants = await tx.execute(sql`SELECT 1 FROM sport_center.x904_nonmember_daily_access
        WHERE device_serial=${DEVICE} AND user_pin=${pin}
          AND (access_state IN ('pending','active') OR activated_at IS NOT NULL)
        LIMIT 1`);
      if (grants.rows.length) return;
      const commands = await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND user_pin=${pin} LIMIT 1`);
      if (commands.rows.length) return;
      const registry = await tx.execute(sql`SELECT 1 FROM sport_center.x904_verified_nonmember_identities
        WHERE device_serial=${DEVICE} AND user_pin=${pin} LIMIT 1`);
      if (registry.rows.length) return;

      const key = x904AutomaticCommandKey(
        `new-ordinary-user:${latest.snapshot_id}:${pin}:${uid}`, "SUSPEND_USER", pin);
      const payload = JSON.stringify({
        source: "AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND",
        expectedUid: uid, expectedName: name, expectedRole: 0,
        previousSnapshotId: Number(previous.snapshot_id),
        observedSnapshotId: Number(latest.snapshot_id),
        attempt: 1,
      });
      await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
        VALUES (${DEVICE},'SUSPEND_USER',${pin},${payload}::jsonb,${actor},${key})
        ON CONFLICT (idempotency_key) DO NOTHING`);
    });
  }
}

export function startX904NewOrdinaryUserDefaultSuspend(): void {
  if (process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED !== "true") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processX904NewOrdinaryUserDefaultSuspend(); }
    catch (error) {
      console.error("[x904-new-user-default-suspend] cycle failed",
        error instanceof Error ? error.message : String(error));
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
}
