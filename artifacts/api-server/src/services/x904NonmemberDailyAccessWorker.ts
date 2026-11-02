import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isX904AutoSuspendExempt, NONMEMBER_ACCESS_MS } from "./x904NonmemberAccessPolicy";
import { x904AutomaticCommandKey } from "./x904AutomationDecision";

type Store = Pick<typeof db, "execute" | "transaction">;
const DEVICE = "TDBD234200545";
const FRESH_SNAPSHOT_MS = 5 * 60_000;
const RETRY_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 3;

export function startX904NonmemberAccessWorker(): void {
  if (process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED !== "true") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processX904NonmemberDailyAccess(); }
    catch (error) {
      console.error("[x904-nonmember] worker cycle failed",
        error instanceof Error ? error.message : String(error));
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60_000);
  timer.unref();
}

/** Enqueue only. The existing VMSC group executor owns physical writes and ACK. */
export async function processX904NonmemberDailyAccess(store: Store = db, now = new Date()): Promise<void> {
  if (process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_MANUAL_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return;

  const actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  if (!Number.isSafeInteger(actor) || actor <= 0) return;
  const identity = await store.execute(sql`SELECT id FROM sport_center.users
    WHERE id=${actor} AND name='X904 AUTOMATION SERVICE'
      AND registration_source='system_x904_automation'
      AND account_status='inactive' AND email IS NULL AND password_hash IS NULL`);
  if (identity.rows.length !== 1) return;

  const due = await store.execute(sql`SELECT a.access_id,a.user_pin,a.device_uid,a.verified_name,
      a.payment_id,a.confirmed_at,a.expires_at,a.access_state,a.verification_state,
      p.status::text AS payment_status
    FROM sport_center.x904_nonmember_daily_access a
    JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id
    WHERE a.verification_state='verified'
      AND a.payment_id IS NOT NULL AND a.confirmed_at IS NOT NULL AND a.expires_at IS NOT NULL
      AND (a.access_state IN ('pending','active','expired') OR p.status::text IN ('cancelled','rejected','refunded'))
    ORDER BY a.confirmed_at LIMIT 25`);

  for (const row of due.rows as any[]) {
    await store.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904212)`);
      const locked = await tx.execute(sql`SELECT a.access_id,a.user_pin,a.device_uid,a.verified_name,
          a.payment_id,a.confirmed_at,a.expires_at,a.access_state,a.verification_state,
          p.status::text AS payment_status
        FROM sport_center.x904_nonmember_daily_access a
        JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id
        WHERE a.access_id=${Number(row.access_id)} FOR UPDATE OF a`);
      if (locked.rows.length !== 1) return;
      const a = locked.rows[0] as any;
      if (a.verification_state !== "verified" ||
          !/^[0-9]{1,8}$/.test(String(a.user_pin)) ||
          !Number.isSafeInteger(Number(a.device_uid)) || Number(a.device_uid) <= 0 ||
          !String(a.verified_name ?? "").trim()) return;

      const pin = String(a.user_pin);
      const shouldBeActive = a.payment_status === "confirmed" &&
        now.getTime() >= new Date(String(a.confirmed_at)).getTime() &&
        now.getTime() < new Date(String(a.expires_at)).getTime();
      const targetGroup = shouldBeActive ? 1 : 2;
      const commandType = shouldBeActive ? "ACTIVATE_USER" : "SUSPEND_USER";
      if (targetGroup === 2 && isX904AutoSuspendExempt(pin, 0)) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND access_state IN ('pending','active')`);
        return;
      }

      const machine = await tx.execute(sql`SELECT observed_at,user_count,users
        FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=${DEVICE} ORDER BY snapshot_id DESC LIMIT 1`);
      if (machine.rows.length !== 1) {
        if (targetGroup === 2) await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
        return;
      }
      const snap = machine.rows[0] as any;
      const observedAt = new Date(String(snap.observed_at));
      const age = now.getTime() - observedAt.getTime();
      const users = Array.isArray(snap.users) ? snap.users : [];
      if (!Number.isFinite(observedAt.getTime()) || age < 0 || age > FRESH_SNAPSHOT_MS ||
          users.length !== Number(snap.user_count)) {
        if (targetGroup === 2) await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
        return;
      }
      const entries = users.filter((u: any) => String(u.pin) === pin &&
        String(u.name ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") ===
          String(a.verified_name).trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") &&
        Number(u.role) === 0 && u.enabled === true);
      if (entries.length !== 1) {
        if (targetGroup === 2) await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
        return;
      }
      const currentGroup = Number(entries[0].group);
      if (![1,2].includes(currentGroup)) {
        if (targetGroup === 2) await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
        return;
      }

      const prior = await tx.execute(sql`SELECT command_id,state,result,completed_at,created_at,attempts
        FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND payload->>'source'='AUTO_NONMEMBER_GYM_12H'
          AND payload->>'accessId'=${String(a.access_id)}
        ORDER BY created_at DESC LIMIT 1`);
      if (prior.rows.length) {
        const last = prior.rows[0] as any;
        if (last.state === "queued" || last.state === "claimed") return;
        if (last.state === "completed" && (last.result as any)?.readBackConfirmed === true) {
          if (!last.completed_at || observedAt.getTime() <= new Date(String(last.completed_at)).getTime()) return;
          if (currentGroup === targetGroup) {
            await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
              SET access_state=${shouldBeActive ? "active" : "expired"}
              WHERE access_id=${Number(a.access_id)} AND verification_state='verified'`);
            return;
          }
          // A newer authenticated snapshot proves the previous command's
          // group change has since been superseded (e.g. 12h expiry).
          // It is now safe to enqueue the opposite transition.
        }
        else if (last.state === "failed") {
          const errorCode = String((last.result as any)?.errorCode ?? "");
          const attempts = Number((last as any).attempts ?? 1);
          if (errorCode !== "DEVICE_BUSY" || (last.result as any)?.readBackConfirmed !== false ||
              !last.completed_at || attempts >= MAX_ATTEMPTS ||
              now.getTime() - new Date(String(last.completed_at)).getTime() < RETRY_DELAY_MS ||
              observedAt.getTime() <= new Date(String(last.completed_at)).getTime()) {
            await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
              SET access_state='review_required'
              WHERE access_id=${Number(a.access_id)}`);
            return;
          }
        } else return;
      }

      if (currentGroup === targetGroup) {
        // A fresh authenticated snapshot already matches the required group.
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state=${shouldBeActive ? "active" : "expired"}
          WHERE access_id=${Number(a.access_id)} AND verification_state='verified'`);
        return;
      }
      if (commandType === "SUSPEND_USER" && isX904AutoSuspendExempt(pin, Number(entries[0].role))) return;

      const inFlight = await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND user_pin=${pin}
          AND state IN ('queued','claimed') LIMIT 1`);
      if (inFlight.rows.length) return;
      const priorCount = Number((await tx.execute(sql`SELECT count(*)::int AS n
        FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND payload->>'source'='AUTO_NONMEMBER_GYM_12H'
          AND payload->>'accessId'=${String(a.access_id)}`)).rows[0]?.n ?? 0);
      if (priorCount >= MAX_ATTEMPTS) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
        return;
      }
      const attempt = priorCount + 1;
      const key = x904AutomaticCommandKey("nonmember-12h:" + a.access_id + ":" + attempt, commandType, pin);
      const payload = JSON.stringify({
        expectedUid: Number(a.device_uid), expectedName: String(a.verified_name),
        source: "AUTO_NONMEMBER_GYM_12H", accessId: Number(a.access_id),
        expiresAt: new Date(String(a.expires_at)).toISOString(), attempt,
      });
      await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
        VALUES (${DEVICE},${commandType},${pin},${payload}::jsonb,${actor},${key})
        ON CONFLICT (idempotency_key) DO NOTHING`);
    });
  }
}
