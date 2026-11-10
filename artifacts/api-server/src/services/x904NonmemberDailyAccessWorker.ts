import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isX904AutoSuspendExempt, x904NonmemberOpeningHours, x904NonmemberEffectiveExpiry, x904NonmemberSameWibDate } from "./x904NonmemberAccessPolicy";
import { x904AutomaticCommandKey } from "./x904AutomationDecision";

type Store = Pick<typeof db, "execute" | "transaction">;
const DEVICE = "TDBD234200545";
const FRESH_SNAPSHOT_MS = 5 * 60_000;
const RETRY_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 3;

export function startX904NonmemberAccessWorker(): void {
  const enabled = process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED === "true";
  const onlyPin = process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  const validPin = onlyPin === undefined || /^[0-9]{1,8}$/.test(onlyPin);
  const actor = Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  const validActor = Number.isSafeInteger(actor) && actor > 0;
  console.info("[x904-nonmember] worker startup", JSON.stringify({
    enabled,
    onlyPin: validPin ? (onlyPin ?? null) : "INVALID",
    grantScope: "verified_paid_nonmember_grants",
    actor: validActor ? actor : "INVALID",
    manualAccessEnabled: process.env.GYM_X904_MANUAL_ACCESS_ENABLED === "true",
    userWriteEnabled: process.env.GYM_X904_USER_WRITE_ENABLED === "true",
    intervalMs: 60000,
  }));
  if (!enabled || !validPin || !validActor) return;
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

/**
 * Advance-paid Gym visits only become eligible on their booking day, at the
 * facility's scheduled start. Accept the stored YYYY-MM-DD / HH:mm shape only.
 * Fail closed on absent/corrupt dates; never open a door early.
 */
export function x904NonmemberScheduledStart(bookingDate: unknown, startTime: unknown): number | null {
  const date = String(bookingDate ?? "").trim();
  const time = String(startTime ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return null;
  const scheduled = Date.parse(`${date}T${time.length === 5 ? time + ":00" : time}+07:00`);
  if (!Number.isFinite(scheduled)) return null;
  // Date.parse normalizes invalid dates; reject that normalization.
  const rebuilt = new Date(scheduled + 7 * 3600000).toISOString().slice(0, 10);
  if (rebuilt !== date) return null;
  return scheduled;
}

/** Enqueue only. The existing VMSC group executor owns physical writes and ACK. */
export async function processX904NonmemberDailyAccess(store: Store = db, now = new Date()): Promise<void> {
  if (process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_MANUAL_ACCESS_ENABLED !== "true" ||
      process.env.GYM_X904_USER_WRITE_ENABLED !== "true") return;

  // Optional controlled rollout: when configured, no other PIN may be processed.
  const testPin = process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  if (testPin !== undefined && !/^[0-9]{1,8}$/.test(testPin)) return;
  // The legacy PIN allowlist is not an authorization source. Authorization
  // requires a verified paid grant, current device attestation and ACK.

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

  // Legacy nonmember ownership confirmed by the Sport Center operator on 2026-11-05.
  // Explicitly scoped to these three identities; absence of member mapping
  // never authorizes any other PIN. No payment/grant is fabricated.
  // A registry row requires independent operator verification, a fixed UID and
  // exact name. Never infer nonmembership merely from missing member mapping.
  const registryReady = await store.execute(sql`SELECT to_regclass('sport_center.x904_verified_nonmember_identities') IS NOT NULL AS ready`);
  // Missing migration must not interrupt the existing paid-grant / VIS worker.
  const verifiedRows = registryReady.rows[0]?.ready === true
    ? await store.execute(sql`SELECT user_pin,device_uid,display_name
        FROM sport_center.x904_verified_nonmember_identities
        WHERE device_serial=${DEVICE} AND verification_state='verified'
          AND revoked_at IS NULL`)
    : { rows: [] };
  if (registryReady.rows[0]?.ready !== true)
    console.warn("[x904-nonmember] registry unavailable; legacy reconciliation skipped");
  const verifiedLegacyNonmembers = verifiedRows.rows.map((r: any) => ({
    pin: String(r.user_pin), uid: Number(r.device_uid), name: String(r.display_name),
  }));
  const legacySnapshot = await store.execute(sql`SELECT observed_at,user_count,users
    FROM sport_center.gym_x904_access_snapshots
    WHERE device_serial=${DEVICE} ORDER BY snapshot_id DESC LIMIT 1`);
  if (legacySnapshot.rows.length === 1) {
    const snapshot = legacySnapshot.rows[0] as any;
    const observedAt = new Date(String(snapshot.observed_at));
    const users = Array.isArray(snapshot.users) ? snapshot.users : [];
    if (Number.isFinite(observedAt.getTime()) &&
        now.getTime() >= observedAt.getTime() &&
        now.getTime() - observedAt.getTime() <= FRESH_SNAPSHOT_MS &&
        users.length === Number(snapshot.user_count)) {
      for (const { pin, uid, name: expectedName } of verifiedLegacyNonmembers) {
        if (testPin !== undefined && testPin !== pin) continue;
        await store.transaction(async tx => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(904212)`);
          // Recheck registry authorization under lock. A previously fetched
          // verified identity may have been revoked or edited since the cycle
          // began; never enqueue a suspend based on that stale authorization.
          const approved = await tx.execute(sql`SELECT device_uid,display_name
            FROM sport_center.x904_verified_nonmember_identities
            WHERE device_serial=${DEVICE} AND user_pin=${pin}
              AND verification_state='verified' AND revoked_at IS NULL
            FOR UPDATE`);
          if (approved.rows.length !== 1 ||
              Number(approved.rows[0].device_uid) !== uid ||
              String(approved.rows[0].display_name).trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") !==
                expectedName.trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID")) return;
          // Fail closed if any membership mapping exists, regardless of status.
          const owner = await tx.execute(sql`SELECT 1 FROM sport_center.gym_x904_member_mapping
            WHERE device_serial=${DEVICE} AND user_pin=${pin} LIMIT 1`);
          if (owner.rows.length) return;
          const matches = users.filter((u: any) =>
            String(u.pin) === pin &&
            String(u.name ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") ===
              expectedName.toLocaleUpperCase("id-ID") &&
            Number(u.role) === 0 && u.enabled === true);
          if (matches.length !== 1 || isX904AutoSuspendExempt(pin, Number(matches[0].role))) return;
          if (Number(matches[0].group) !== 1) return;
          const deviceUser = await tx.execute(sql`SELECT device_uid,display_name,device_role
            FROM sport_center.gym_x904_lan_users
            WHERE device_serial=${DEVICE} AND user_pin=${pin}`);
          if (deviceUser.rows.length !== 1) return;
          const identity = deviceUser.rows[0] as any;
          if (!Number.isSafeInteger(Number(identity.device_uid)) || Number(identity.device_uid) <= 0 || Number(identity.device_uid) !== uid ||
              Number(identity.device_role) !== 0 ||
              String(identity.display_name).trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID") !==
                expectedName.toLocaleUpperCase("id-ID")) return;
          // A paid, currently valid grant takes priority over legacy cleanup.
          const grant = await tx.execute(sql`SELECT 1 FROM sport_center.x904_nonmember_daily_access
            WHERE device_serial=${DEVICE} AND user_pin=${pin}
              AND (access_state IN ('pending','active')
                OR (access_state='review_required' AND payment_id IS NOT NULL)) LIMIT 1`);
          // A paid grant awaiting ACK recovery remains owned by the paid-access
          // worker. Legacy cleanup must not enqueue a competing unscoped suspend.
          if (grant.rows.length) return;
          const existing = await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
            WHERE device_serial=${DEVICE} AND user_pin=${pin}
              AND (state IN ('queued','claimed') OR
                (command_type='SUSPEND_USER' AND payload->>'source'='AUTO_NONMEMBER_LEGACY_VERIFIED'))
            LIMIT 1`);
          if (existing.rows.length) return;
          const key = x904AutomaticCommandKey(`verified-legacy-nonmember:${pin}:${uid}`, "SUSPEND_USER", pin);
          const payload = JSON.stringify({
            expectedUid: Number(identity.device_uid), expectedName,
            source: "AUTO_NONMEMBER_LEGACY_VERIFIED",
            verifiedBy: "registry", attempt: 1,
          });
          await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
            (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
            VALUES (${DEVICE},'SUSPEND_USER',${pin},${payload}::jsonb,${actor},${key})
            ON CONFLICT (idempotency_key) DO NOTHING`);
        });
      }
    }
  }

  // Only independently verified paid grants can enqueue X904 access commands.
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
      const locked = await tx.execute(sql`SELECT a.access_id,a.booking_id,a.user_pin,a.device_uid,a.verified_name,
          a.payment_id,a.confirmed_at,a.expires_at,a.activated_at,a.access_state,a.verification_state,
          p.status::text AS payment_status,
          booking.booking_date AS booking_date, booking.start_time AS booking_start_time,
          booking.source AS booking_source, booking.notes AS booking_notes,
          booking.status::text AS booking_status,
          a.identity_type AS identity_type, a.identity_label AS identity_label
        FROM sport_center.x904_nonmember_daily_access a
        LEFT JOIN sport_center.sport_payments p ON p.id=a.payment_id AND p.booking_id=a.booking_id
        LEFT JOIN sport_center.sport_bookings booking ON booking.id=a.booking_id
        WHERE a.access_id=${Number(row.access_id)} FOR UPDATE OF a`);
      if (locked.rows.length !== 1) return;
      const a = locked.rows[0] as any;
      if (a.verification_state !== "verified" ||
          !/^[0-9]{1,8}$/.test(String(a.user_pin)) ||
          !Number.isSafeInteger(Number(a.device_uid)) || Number(a.device_uid) <= 0 ||
          !String(a.verified_name ?? "").trim()) return;

      // Only the new self-service VIS flow requires witnessed physical handover.
      // Legacy verified-card/PIN grants retain their established behavior.
      if (a.identity_type === "card" &&
          ((a.booking_source === "gym_public_guest" &&
            String(a.booking_notes ?? "").includes("Kartu VIS001–VIS006 menunggu pilihan")) ||
            a.booking_source === "web")) {
        // A revoked booking must never initiate activation. Do not skip an
        // already activated entitlement, though: it must still reach the
        // regular SUSPEND_USER path and receive verified device read-back.
        if ((a.booking_status !== "confirmed" || a.payment_status !== "confirmed") &&
            a.activated_at == null) return;
        const handover = await tx.execute(sql`SELECT 1
          FROM sport_center.gym_vis_card_reservations r
          WHERE r.booking_id=${Number(a.booking_id)}
            AND r.payment_id=${Number(a.payment_id)}
            AND r.device_serial=${DEVICE}
            AND r.card_code=${String(a.identity_label)}
            AND r.user_pin=${String(a.user_pin)}
            AND r.device_uid=${Number(a.device_uid)}
            AND r.state='collected' AND r.collected_at IS NOT NULL
          LIMIT 1`);
        if (handover.rows.length !== 1) return;
        // A reservation may not be activated after its booking-day closing.
        if (!a.activated_at && (!a.expires_at ||
            now.getTime() >= new Date(String(a.expires_at)).getTime())) return;
      }
      const pin = String(a.user_pin);
      if (testPin !== undefined && pin !== testPin) return;
      const scheduledStart = x904NonmemberScheduledStart(a.booking_date, a.booking_start_time);
      if (scheduledStart === null) {
        console.warn("[x904-nonmember] booking schedule invalid; access held", JSON.stringify({accessId:Number(a.access_id)}));
        return;
      }
      // GYM late arrivals remain eligible on the SAME booking day after the
      // displayed one-hour session has ended. That tariff window is not the
      // X904 entitlement expiry. Never activate before scheduled start, on a
      // different day, or after 23:00 WIB. Existing grants can finish.
      if (a.activated_at == null && now.getTime() < scheduledStart) return;
      // A pending booking belongs to its scheduled WIB date. If activation
      // was missed, never activate it after the facility reopens next day.
      // Advance payments for future reservations may activate on that day.
      if (a.activated_at == null && !x904NonmemberSameWibDate(now, new Date(scheduledStart))) {
        await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
          SET access_state='review_required'
          WHERE access_id=${Number(a.access_id)} AND access_state IN ('pending','active')`);
        return;
      }
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
      // Never activate outside 06:00–23:00 WIB. For an already active grant,
      // its effective expiry is the earlier of 12 hours and closing at 23:00
      // on the original activation day; it cannot reopen tomorrow morning.
      const activeStart = a.activated_at ? new Date(String(a.activated_at)) : null;
      const expiry = activeStart
        ? x904NonmemberEffectiveExpiry(activeStart, new Date(String(a.expires_at)))
        : null;
      // A web booking attached to a physical VIS must be confirmed to activate.
      // Cancellation/completion causes the ordinary verified SUSPEND path.
      const bookingEligible = a.booking_source === "web" && a.identity_type === "card"
        ? a.booking_status === "confirmed"
        : a.booking_source !== "gym_public_guest" || ["confirmed","completed"].includes(String(a.booking_status));
      const shouldBeActive = bookingEligible &&
        a.payment_status === "confirmed" &&
        x904NonmemberOpeningHours(now) &&
        now.getTime() >= new Date(String(a.confirmed_at)).getTime() &&
        // The clock starts on verified ACTIVATE ACK, not at advance payment.
        (activeStart === null || (expiry !== null &&
          Number.isFinite(expiry.getTime()) && now.getTime() < expiry.getTime()));
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
            AND other.confirmed_at<=${now}
            AND other.activated_at IS NOT NULL
            AND LEAST(other.expires_at,
              ((other.activated_at AT TIME ZONE 'Asia/Jakarta')::date + time '23:00')
                AT TIME ZONE 'Asia/Jakarta')>${now}
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

      const prior = await tx.execute(sql`SELECT command_id,command_type,state,result,payload,completed_at,created_at,attempts
        FROM sport_center.x904_user_commands
        WHERE device_serial=${DEVICE}
          AND payload->>'source' IN ('AUTO_NONMEMBER_GYM_12H','MANUAL_NONMEMBER_ACCESS_CLOSE')
          AND payload->>'accessId'=${String(a.access_id)}
        ORDER BY created_at DESC LIMIT 1`);
      if (prior.rows.length) {
        const last = prior.rows[0] as any;
        const lastSource = String((last as any).payload?.source ?? "");
        if (last.state === "queued" || last.state === "claimed") return;
        if (lastSource === "MANUAL_NONMEMBER_ACCESS_CLOSE") {
          if (last.state === "completed" && (last.result as any)?.readBackConfirmed === true &&
              Number((last.result as any)?.deviceUid) === Number(a.device_uid) &&
              Number((last.result as any)?.afterGroup) === 2 && last.completed_at &&
              observedAt.getTime() > new Date(String(last.completed_at)).getTime() && currentGroup === 2) {
            await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
              SET access_state='expired'
              WHERE access_id=${Number(a.access_id)} AND verification_state='verified'`);
          }
          return;
        }
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
            // Both activation AND suspension need the intended UID and group.
            // A Group 2 snapshot alone cannot validate an ACK for another user.
            if (Number((last.result as any)?.afterGroup) !== targetGroup ||
                Number((last.result as any)?.deviceUid) !== Number(a.device_uid)) {
              await tx.execute(sql`UPDATE sport_center.x904_nonmember_daily_access
                SET access_state='review_required' WHERE access_id=${Number(a.access_id)}`);
              return;
            }
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
                    expires_at=LEAST(
                      COALESCE(activated_at,${ackTime}) + interval '12 hours',
                      ((COALESCE(activated_at,${ackTime}) AT TIME ZONE 'Asia/Jakarta')::date + time '23:00')
                        AT TIME ZONE 'Asia/Jakarta'),
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
