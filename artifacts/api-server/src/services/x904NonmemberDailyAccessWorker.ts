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
  const enabled = process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED === "true";
  const onlyPin = process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  const allowed = process.env.GYM_X904_NONMEMBER_ALLOWED_PINS;
  const validPin = onlyPin === undefined || /^[0-9]{1,8}$/.test(onlyPin);
  const actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  const validActor = Number.isSafeInteger(actor) && actor > 0;
  const validAllowlist = allowed === undefined || (allowed.length > 0 && allowed.split(",").every(pin => /^[0-9]{1,8}$/.test(pin.trim())));
  console.info("[x904-nonmember] worker startup", JSON.stringify({
    enabled,
    onlyPin: validPin ? (onlyPin ?? null) : "INVALID",
    allowedPins: validAllowlist ? (allowed ?? null) : "INVALID",
    actor: validActor ? actor : "INVALID",
    manualAccessEnabled: process.env.GYM_X904_MANUAL_ACCESS_ENABLED === "true",
    userWriteEnabled: process.env.GYM_X904_USER_WRITE_ENABLED === "true",
    intervalMs: 60000,
  }));
  if (!enabled || !validPin || !validActor || !validAllowlist || (onlyPin === undefined && allowed === undefined)) return;
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

  // Optional controlled rollout: when configured, no other PIN may be processed.
  const testPin = process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  if (testPin !== undefined && !/^[0-9]{1,8}$/.test(testPin)) return;
  const allowedRaw = process.env.GYM_X904_NONMEMBER_ALLOWED_PINS;
  const allowed = allowedRaw?.split(",").map(pin => pin.trim());
  if (allowed && (allowed.length === 0 || allowed.some(pin => !/^[0-9]{1,8}$/.test(pin)))) return;
  if (testPin === undefined && !allowed) return;

  const actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  if (!Number.isSafeInteger(actor) || actor <= 0) return;
  const identity = await store.execute(sql`SELECT id FROM sport_center.users
    WHERE id=${actor} AND name='X904 AUTOMATION SERVICE'
      AND registration_source='system_x904_automation'
      AND account_status='inactive' AND email IS NULL AND password_hash IS NULL`);
  if (identity.rows.length !== 1) return;

  // Inventory reconciliation is read-only unless a PIN has an independently
  // verified nonmember grant. An absent member mapping is NOT proof of nonmembership.
  // In particular, do not enqueue commands for legacy PINs based on Group 1 alone.
  const inventory = await store.execute(sql`SELECT observed_at,user_count,users
    FROM sport_center.gym_x904_access_snapshots
    WHERE device_serial=${DEVICE} ORDER BY snapshot_id DESC LIMIT 1`);
  if (inventory.rows.length === 1) {
    const snapshot = inventory.rows[0] as any;
    const observed = new Date(String(snapshot.observed_at));
    const users = Array.isArray(snapshot.users) ? snapshot.users : [];
    if (Number.isFinite(observed.getTime()) &&
        now.getTime() >= observed.getTime() &&
        now.getTime() - observed.getTime() <= FRESH_SNAPSHOT_MS &&
        users.length === Number(snapshot.user_count)) {
      const mappings = await store.execute(sql`SELECT user_pin
        FROM sport_center.gym_x904_member_mapping WHERE device_serial=${DEVICE}`);
      const memberPins = new Set(mappings.rows.map((r: any) => String(r.user_pin)));
      const grants = await store.execute(sql`SELECT DISTINCT user_pin
        FROM sport_center.x904_nonmember_daily_access
        WHERE device_serial=${DEVICE} AND verification_state='verified'
          AND identity_type IN ('card','pin')`);
      const verifiedPins = new Set(grants.rows.map((r: any) => String(r.user_pin)));
      const classes = { member: 0, verifiedNonmember: 0, exempt: 0, reviewRequired: 0 };
      for (const user of users) {
        const pin = String(user.pin ?? "");
        const role = Number(user.role);
        if (isX904AutoSuspendExempt(pin, role)) classes.exempt++;
        else if (memberPins.has(pin)) classes.member++;
        else if (verifiedPins.has(pin) && role === 0) classes.verifiedNonmember++;
        else classes.reviewRequired++;
      }
      console.info("[x904-nonmember] inventory reconciliation", JSON.stringify({
        observedAt: observed.toISOString(), classes,
        note: "reviewRequired PINs are never suspended without verified ownership",
      }));
    }
  }

  // Reconcile only identities absent from both current and historical memberships.
  // Opt-in; physical execution and ACK remain owned by the VMSC executor.
  if (process.env.GYM_X904_NONMEMBER_LEGACY_RECONCILE_ENABLED === "true") {
    await store.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904212)`);
      const latest = await tx.execute(sql`SELECT snapshot_id,observed_at,user_count,users
        FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=${DEVICE} ORDER BY snapshot_id DESC LIMIT 1`);
      const snap = latest.rows[0] as any;
      const observed = snap && new Date(String(snap.observed_at));
      const users = Array.isArray(snap?.users) ? snap.users : [];
      if (!snap || !Number.isFinite(observed.getTime()) ||
          now.getTime() < observed.getTime() ||
          now.getTime() - observed.getTime() > FRESH_SNAPSHOT_MS ||
          users.length !== Number(snap.user_count)) return;
      let queued = 0;
      for (const u of users) {
        if (queued >= 10) break;
        const pin = String(u.pin ?? ""), name = String(u.name ?? "").trim();
        if (!/^[0-9]{1,8}$/.test(pin) || !name || u.enabled !== true ||
            Number(u.group) !== 1 || Number(u.role) !== 0 ||
            isX904AutoSuspendExempt(pin, 0) ||
            (testPin !== undefined && pin !== testPin)) continue;
        const match = await tx.execute(sql`SELECT device_uid FROM sport_center.gym_x904_lan_users
          WHERE device_serial=${DEVICE} AND user_pin=${pin}
            AND last_seen_snapshot=${Number(snap.snapshot_id)}
            AND device_role=0 AND upper(trim(display_name))=upper(${name})`);
        if (match.rows.length !== 1) continue;
        const uid = Number((match.rows[0] as any).device_uid);
        if (!Number.isSafeInteger(uid) || uid <= 0) continue;
        const protectedIdentity = await tx.execute(sql`SELECT
          EXISTS(SELECT 1 FROM sport_center.gym_x904_member_mapping
            WHERE device_serial=${DEVICE} AND user_pin=${pin}) AS mapped,
          EXISTS(SELECT 1 FROM sport_center.sport_memberships
            WHERE lower(trim(name))=lower(trim(${name}))) AS current_member,
          EXISTS(SELECT 1 FROM sport_center.sport_memberships_sync
            WHERE lower(trim(name))=lower(trim(${name}))) AS former_member,
          EXISTS(SELECT 1 FROM sport_center.x904_nonmember_daily_access
            WHERE device_serial=${DEVICE} AND user_pin=${pin}) AS has_grant,
          EXISTS(SELECT 1 FROM sport_center.x904_user_commands
            WHERE device_serial=${DEVICE} AND user_pin=${pin}
              AND state IN ('queued','claimed')) AS in_flight`);
        const p = protectedIdentity.rows[0] as any;
        if (!p || p.mapped || p.current_member || p.former_member || p.has_grant || p.in_flight) continue;
        const key = x904AutomaticCommandKey("never-member-reconcile:" + pin, "SUSPEND_USER", pin);
        const payload = JSON.stringify({
          source: "AUTO_NONMEMBER_LEGACY_RECONCILIATION",
          reason: "NO_MEMBERSHIP_HISTORY_NO_PAID_GRANT",
          expectedUid: uid, expectedName: name,
        });
        const result = await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
          (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
          VALUES (${DEVICE},'SUSPEND_USER',${pin},${payload}::jsonb,${actor},${key})
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING command_id`);
        if (result.rows.length) queued++;
      }
      console.info("[x904-nonmember] never-member queued", JSON.stringify({ queued }));
    });
  }

  const due = await store.execute(sql`SELECT a.access_id,a.user_pin,a.device_uid,a.verified_name,
      a.payment_id,a.confirmed_at,a.expires_at,a.activated_at,a.access_state,a.verification_state,
      p.status::text AS payment_status
    FROM sport_center.x904_nonmember_daily_access a
    LEFT JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id
    WHERE a.verification_state='verified'
      AND a.identity_type IN ('card','pin')
      AND ((a.payment_id IS NOT NULL AND a.confirmed_at IS NOT NULL AND a.expires_at IS NOT NULL
        AND (a.access_state IN ('pending','active','review_required') OR (a.access_state <> 'expired' AND p.status::text IN ('cancelled','rejected','refunded'))))
        )
      AND (${testPin ?? null}::text IS NULL OR a.user_pin=${testPin ?? null})
      -- Verified paid grants cover both VIS cards and ordinary nonmember PINs.
      -- The card allowlist must not silently exclude verified PIN bookings.
    ORDER BY a.confirmed_at LIMIT 25`);

  for (const row of due.rows as any[]) {
    await store.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904212)`);
      const locked = await tx.execute(sql`SELECT a.access_id,a.user_pin,a.device_uid,a.verified_name,
          a.payment_id,a.confirmed_at,a.expires_at,a.activated_at,a.access_state,a.verification_state,
          p.status::text AS payment_status
        FROM sport_center.x904_nonmember_daily_access a
        LEFT JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id
        WHERE a.access_id=${Number(row.access_id)} FOR UPDATE OF a`);
      if (locked.rows.length !== 1) return;
      const a = locked.rows[0] as any;
      if (a.verification_state !== "verified" ||
          !/^[0-9]{1,8}$/.test(String(a.user_pin)) ||
          !Number.isSafeInteger(Number(a.device_uid)) || Number(a.device_uid) <= 0 ||
          !String(a.verified_name ?? "").trim()) return;

      const pin = String(a.user_pin);
      if (testPin !== undefined && pin !== testPin) return;
      // Do not apply the VIS card allowlist to verified paid nonmember PIN grants.
      // Membership ownership, exempt roles/PINs, device identity and payment
      // verification below remain mandatory for every PIN.
      // All allowed card and PIN identities must pass the same ownership checks.
      const owners = await tx.execute(sql`SELECT membership_id,status
        FROM sport_center.gym_x904_member_mapping
        WHERE device_serial=${DEVICE} AND user_pin=${pin}`);
      if (owners.rows.length > 0) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND access_state IN ('pending','active')`);
        return;
      }
      // Never suspend an exempt PIN, even if it is presently recorded as a
      // nonmember paid access. The exemption applies to both transitions to
      // prevent the 12-hour worker taking ownership of special access.
      if (isX904AutoSuspendExempt(pin, 0)) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND access_state IN ('pending','active')`);
        return;
      }
      const shouldBeActive = a.payment_status === "confirmed" &&
        now.getTime() >= new Date(String(a.confirmed_at)).getTime() &&
        (a.activated_at == null || now.getTime() < new Date(String(a.expires_at)).getTime());
      const targetGroup = shouldBeActive ? 1 : 2;
      const commandType = shouldBeActive ? "ACTIVATE_USER" : "SUSPEND_USER";
      // A cancelled payment without verified activation must never suspend a
      // pre-existing Group 1 user (including a member sharing this PIN).
      if (!shouldBeActive && a.activated_at == null) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND access_state <> 'review_required'`);
        return;
      }
      // Never attribute an old Group 1 state to a paid access grant without
      // a verified ACTIVATE ACK. Historical grants remain review_required;
      // newly confirmed bookings continue through the shared VIS006 worker.
      if (a.activated_at == null && a.access_state === "review_required" && shouldBeActive) {
        const evidence = await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
          WHERE device_serial=${DEVICE} AND user_pin=${pin}
            AND command_type='ACTIVATE_USER' AND state='completed'
            AND payload->>'source'='AUTO_NONMEMBER_GYM_12H'
            AND payload->>'accessId'=${String(a.access_id)}
            AND result->>'readBackConfirmed'='true'
          LIMIT 1`);
        if (!evidence.rows.length) return;
      }
      if (targetGroup === 2 && isX904AutoSuspendExempt(pin, 0)) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND access_state IN ('pending','active')`);
        return;
      }

      // Do not suspend a PIN that also has a confirmed, unexpired access grant.
      // A later/parallel confirmed grant for the same PIN must take priority
      // over an older grant's expiry. Do not suspend the shared machine user.
      if (targetGroup === 2) {
        const overlapping = await tx.execute(sql`SELECT 1
          FROM sport_center.x904_nonmember_daily_access other
          JOIN sport_center.sport_payments pay
            ON pay.id=other.payment_id AND pay.booking_id=other.booking_id
          WHERE other.device_serial=${DEVICE} AND other.user_pin=${pin}
            AND other.access_id<>${Number(a.access_id)}
            AND pay.status::text='confirmed'
            AND other.confirmed_at<=${now} AND other.expires_at>${now}
          LIMIT 1`);
        if (overlapping.rows.length) return;
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
      // The authenticated inventory has no UID field; only the physical
      // executor can attest UID. Never accept a successful group transition
      // without its expected deviceUid in the completed ACK.
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

      const prior = await tx.execute(sql`SELECT command_id,command_type,state,result,completed_at,created_at,attempts
        FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND payload->>'source'='AUTO_NONMEMBER_GYM_12H'
          AND payload->>'accessId'=${String(a.access_id)}
        ORDER BY created_at DESC LIMIT 1`);
      if (prior.rows.length) {
        const last = prior.rows[0] as any;
        if (last.state === "queued" || last.state === "claimed") return;
        if (last.state === "completed" && (last.result as any)?.readBackConfirmed === true) {
          if (last.command_type !== commandType) {
            if (currentGroup === targetGroup && shouldBeActive) {
              await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
                SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
              return;
            }
            // Opposite transition can proceed only after a verified activation.
          }
          if (!last.completed_at || observedAt.getTime() <= new Date(String(last.completed_at)).getTime()) return;
          if (currentGroup === targetGroup && last.command_type === commandType) {
            if (shouldBeActive) {
              const ackGroup = Number((last.result as any)?.afterGroup);
              const ackUid = Number((last.result as any)?.deviceUid);
              const ackTime = new Date(String(last.completed_at));
              if (ackGroup !== 1 || ackUid !== Number(a.device_uid) ||
                  !Number.isFinite(ackTime.getTime()) ||
                  ackTime.getTime() < new Date(String(a.confirmed_at)).getTime()) {
                await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
                  SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
                return;
              }
              await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
                SET activated_at=COALESCE(activated_at,${ackTime}),
                    expires_at=COALESCE(activated_at,${ackTime}) + interval '12 hours',
                    access_state='active'
                WHERE access_id=${Number(a.access_id)} AND verification_state='verified'
                  AND payment_id=${Number(a.payment_id)}`);
            } else {
              await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
                SET access_state='expired'
                WHERE access_id=${Number(a.access_id)} AND verification_state='verified'`);
            }
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
        // A confirmed payment does not prove that an existing Group 1 was
        // activated by this grant. Require a matching completed ACTIVATE ACK
        // and a newer device snapshot before assigning the 12-hour clock.
        if (shouldBeActive) {
          const reviewed = await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
            SET access_state='review_required'
            WHERE access_id=${Number(a.access_id)} AND verification_state='verified'
              AND access_state <> 'review_required'
            RETURNING access_id`);
          if (reviewed.rows.length) console.warn("[x904-nonmember] unattributed group1 requires review", JSON.stringify({
            accessId: Number(a.access_id), pin, reason: "GROUP1_WITHOUT_MATCHING_ACTIVATION_ACK",
          }));
          return;
        }
        // Group 2 alone does not prove this worker suspended the paid access.
        // Preserve the grant for review until a matching SUSPEND ACK and
        // newer authenticated snapshot are observed above.
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND verification_state='verified'
            AND access_state <> 'review_required'`);
        return;
      }
      if (commandType === "SUSPEND_USER" && isX904AutoSuspendExempt(pin, Number(entries[0].role))) return;

      const inFlight = await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND user_pin=${pin}
          AND state IN ('queued','claimed') LIMIT 1`);
      if (inFlight.rows.length) return;
      const priorCount = Number((await tx.execute(sql`SELECT count(*)::int AS n
        FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE} AND command_type=${commandType}
          AND payload->>'source'='AUTO_NONMEMBER_GYM_12H'
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
        expiresAt: a.expires_at ? new Date(String(a.expires_at)).toISOString() : null, attempt,
      });
      await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
        VALUES (${DEVICE},${commandType},${pin},${payload}::jsonb,${actor},${key})
        ON CONFLICT (idempotency_key) DO NOTHING`);
    });
  }
}
