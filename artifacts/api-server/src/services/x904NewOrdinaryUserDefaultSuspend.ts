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

  // Read-only SLA monitor. A queued command or completed command without
  // device read-back is never counted as successful suspension.
  const overdue = await store.execute(sql`SELECT count(*)::int AS overdue_count
    FROM sport_center.x904_user_commands c
    WHERE c.device_serial=${DEVICE}
      AND c.payload->>'source'='AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND'
      AND (c.payload->>'suspendDeadlineAt')::timestamptz <= ${now}
      AND NOT (c.command_type='SUSPEND_USER' AND c.state='completed'
        AND c.result->>'readBackConfirmed'='true'
        AND c.result->>'afterGroup'='2')`);
  const count = Number(overdue.rows[0]?.overdue_count ?? 0);
  if (count > 0) {
    console.error("[x904-new-user-default-suspend] 30min read-back SLA exceeded", JSON.stringify({
      overdueCount: count, action: "investigate_vmsc_and_device",
    }));
  }

  // A snapshot arrives about every three minutes. Retain the transition for
  // 75 minutes so skipped worker ticks never silently lose a newly enrolled PIN.
  // The 30 minute deadline is measured from FIRST OBSERVATION, not an invented
  // device creation timestamp. Physical completion still requires ACK/read-back.
  const snapshots = await store.execute(sql`SELECT snapshot_id, observed_at, user_count, users
    FROM sport_center.gym_x904_access_snapshots
    WHERE device_serial=${DEVICE}
      AND observed_at >= ${new Date(baseline)}
      AND observed_at >= ${new Date(now.getTime() - 75 * 60_000)}
    ORDER BY snapshot_id DESC LIMIT 80`);
  if (snapshots.rows.length < 2) return;
  const allHistory = (snapshots.rows as any[]).reverse();
  // A collector outage must not freeze registration processing for the whole
  // 75-minute window. Use only the newest contiguous segment and still verify
  // the PIN has NEVER appeared in any older snapshot before queuing a command.
  let segmentStart = 0;
  for (let i = 1; i < allHistory.length; i++) {
    const before = new Date(String(allHistory[i - 1].observed_at)).getTime();
    const current = new Date(String(allHistory[i].observed_at)).getTime();
    if (Number.isFinite(before) && Number.isFinite(current) &&
        current - before > 10 * 60_000) segmentStart = i;
  }
  const history = allHistory.slice(segmentStart);
  if (history.length < 2) return;
  const latest = history[history.length - 1];
  const latestTime = new Date(String(latest.observed_at)).getTime();
  if (!Number.isFinite(latestTime) || latestTime > now.getTime() ||
      now.getTime() - latestTime > SNAPSHOT_MAX_AGE_MS) return;

  // An incomplete or discontinuous snapshot history cannot prove a new PIN.
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    const time = new Date(String(row.observed_at)).getTime();
    if (!Number.isFinite(time) || !Array.isArray(row.users) ||
        row.users.length !== Number(row.user_count)) return;
    if (i > 0) {
      const before = new Date(String(history[i - 1].observed_at)).getTime();
      if (time <= before || time - before > 10 * 60_000) return;
    }
  }
  const currentUsers: SnapshotUser[] = latest.users;
  const firstUsers: SnapshotUser[] = history[0].users;
  if (currentUsers.length < firstUsers.length) return;
  const baselinePins = new Set(firstUsers.map(u => String(u.pin ?? "")));
  const newCandidates = currentUsers.filter(u => isNewOrdinaryX904Candidate(u, baselinePins));
  if (!newCandidates.length) return;
  const firstIndexOf = (pin: string): number => history.findIndex(row =>
    (row.users as SnapshotUser[]).some(u => String(u.pin ?? "") === pin));

  // A snapshot with >10 newly enrolled ordinary identities is anomalous.
  // Restrict only THAT transition, not independent legitimate enrollments
  // across many different snapshots during the 75-minute detection window.
  const byTransition = new Map<number, SnapshotUser[]>();
  for (const candidate of newCandidates) {
    const first = firstIndexOf(String(candidate.pin));
    if (first <= 0) continue;
    byTransition.set(first, [...(byTransition.get(first) ?? []), candidate]);
  }
  const allowedCandidates: SnapshotUser[] = [];
  for (const [firstIndex, candidates] of byTransition) {
    if (candidates.length > 10) {
      console.error("[x904-new-user-default-suspend] unexpected-bulk-enrollment",
        JSON.stringify({ snapshotId: history[firstIndex].snapshot_id,
          candidates: candidates.length, maximumPerSnapshot: 10,
          action: "review_snapshot_before_automatic_commands" }));
      continue;
    }
    allowedCandidates.push(...candidates);
  }
  if (!allowedCandidates.length) return;

  // Skip already processed or manually handled PINs BEFORE opening a
  // transaction. This prevents repeated advisory locks and history scans
  // every minute for the same registration during the 75-minute lookback.
  const pins = allowedCandidates.map(u => String(u.pin));
  const existing = await store.execute(sql`SELECT DISTINCT user_pin
    FROM sport_center.x904_user_commands
    WHERE device_serial=${DEVICE} AND user_pin IN (${sql.join(pins.map(pin => sql`${pin}`), sql`,`)})`);
  const previouslyHandled = new Set(existing.rows.map(row => String(row.user_pin)));
  let queuedThisCycle = 0;
  for (const candidate of allowedCandidates) {
    const pin = String(candidate.pin);
    if (previouslyHandled.has(pin)) continue;
    // Small bounded batches prevent device command floods and keep
    // PostgreSQL/VMSC capacity available for bookings and paid access.
    if (queuedThisCycle >= 5) break;
    queuedThisCycle += 1;
    const pin = String(candidate.pin);
    const name = String(candidate.name).trim().replace(/\s+/g, " ");
    const firstIndex = firstIndexOf(pin);
    if (firstIndex <= 0) continue;
    // The preceding snapshot must prove absence; all subsequent snapshots
    // must continue to refer to exactly the same ordinary identity.
    const observedFirst = history[firstIndex];
    const firstSeen = new Date(String(observedFirst.observed_at));
    const deadline = new Date(firstSeen.getTime() + 30 * 60_000);
    if (!Number.isFinite(firstSeen.getTime())) continue;
    if (history.slice(firstIndex).some(row =>
      (row.users as SnapshotUser[]).filter(u =>
        String(u.pin ?? "") === pin &&
        String(u.name ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") ===
          name.toLocaleUpperCase("id-ID") &&
        Number(u.role) === 0).length !== 1)) continue;
    const onlyPin = process.env.GYM_X904_NEW_USER_ONLY_PIN;
    if (onlyPin && pin !== onlyPin) continue;
    await store.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904215)`);
      // Fail closed if a new snapshot appeared or if the PIN had existed in
      // any historical snapshot, including before our activation baseline.
      const check = await tx.execute(sql`SELECT snapshot_id FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=${DEVICE} ORDER BY snapshot_id DESC LIMIT 1`);
      if (check.rows.length !== 1 ||
          Number(check.rows[0].snapshot_id) !== Number(latest.snapshot_id)) return;
      const everSeen = await tx.execute(sql`SELECT 1 FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=${DEVICE} AND snapshot_id < ${Number(observedFirst.snapshot_id)}
          AND users @> jsonb_build_array(jsonb_build_object('pin', ${pin}::text))
        LIMIT 1`);
      if (everSeen.rows.length) return;
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
        `new-ordinary-user:${observedFirst.snapshot_id}:${pin}:${uid}`, "SUSPEND_USER", pin);
      const payload = JSON.stringify({
        source: "AUTO_NEW_ORDINARY_USER_DEFAULT_SUSPEND",
        expectedUid: uid, expectedName: name, expectedRole: 0,
        previousSnapshotId: Number(history[firstIndex - 1].snapshot_id),
        observedSnapshotId: Number(observedFirst.snapshot_id),
        firstObservedAt: firstSeen.toISOString(),
        suspendDeadlineAt: deadline.toISOString(),
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
