import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { X904MembershipPlan } from "./x904MembershipReconciliation";

/**
 * Transactional, idempotent review-receipt worker.
 *
 * Disabled by default. This does not modify membership, mapping, payments or
 * machine access; no scheduler or payment event is wired to it yet.
 *
 * The DB primary key on event_key ensures concurrent retries write one event.
 * For ready receipts, the member/PIN must already be verified by operators.
 */
export async function recordX904MembershipReconciliation(input: {
  membershipId: number;
  deviceSerial: string;
  plan: X904MembershipPlan;
}): Promise<"created" | "duplicate" | "disabled" | "review_required"> {
  if (process.env.GYM_X904_MEMBERSHIP_RECONCILIATION_ENABLED !== "true") return "disabled";
  const { membershipId, deviceSerial, plan } = input;
  if (!Number.isSafeInteger(membershipId) || membershipId <= 0 ||
      deviceSerial !== "TDBD234200545" || !/^[a-f0-9]{64}$/.test(plan.eventKey) ||
      plan.executeDeviceCommand !== false) throw new Error("INVALID_RECONCILIATION_INPUT");

  return db.transaction(async tx => {
    let verified = false;
    if (plan.state === "ready" && plan.userPin && plan.deviceUid) {
      const rows = await tx.execute(sql`
        SELECT 1 FROM sport_center.gym_x904_member_mapping mapping
        JOIN sport_center.gym_x904_lan_users machine
          ON machine.device_serial=mapping.device_serial AND machine.user_pin=mapping.user_pin
        WHERE mapping.device_serial=${deviceSerial}
          AND mapping.membership_id=${membershipId}
          AND mapping.user_pin=${plan.userPin}
          AND mapping.status='verified'
          AND machine.device_uid=${plan.deviceUid}
          AND machine.device_role=0
        LIMIT 1
      `);
      verified = rows.rows.length === 1;
    }
    const safeState = verified && plan.state === "ready" ? "ready" : "review_required";
    const result = await tx.execute(sql`
      INSERT INTO sport_center.gym_x904_membership_reconciliation_outbox
        (event_key,membership_id,device_serial,user_pin,device_uid,entitlement,identity_status,operation_state,payload)
      VALUES (${plan.eventKey},${membershipId},${deviceSerial},
        ${verified ? plan.userPin : null},${verified ? plan.deviceUid : null},
        ${plan.entitlement},${verified ? "verified" : "review_required"},
        ${safeState},${JSON.stringify({ reason: plan.reason, executeDeviceCommand: false })}::jsonb)
      ON CONFLICT (event_key) DO NOTHING
      RETURNING event_key
    `);
    if (!result.rows.length) return "duplicate";
    return verified ? "created" : "review_required";
  });
}
