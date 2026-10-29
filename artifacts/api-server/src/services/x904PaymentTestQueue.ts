import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { planX904PaymentTestCommand } from "./x904PaymentCommandGate";

/**
 * Explicit DEV-only integration seam. Never exports a production write path.
 * Physical executor is NOT connected: an isolated DEV queue is not consumed by VMSC.
 */
export async function queueConfirmedX904DevTest(input: {
  membershipId: number;
  eventKey: string;
  entitlement: "active" | "grace_period" | "suspended" | "review_required";
}): Promise<"queued" | "duplicate" | "held" | "disabled"> {
  if (process.env.NODE_ENV === "production" ||
      process.env.GYM_X904_PAYMENT_TEST_QUEUE_ENABLED !== "true" ||
      process.env.GYM_X904_MANUAL_ACCESS_TEST_PIN !== "200") return "disabled";
  if (!Number.isSafeInteger(input.membershipId) || input.membershipId <= 0) return "held";
  return db.transaction(async tx => {
    // DEV-only: require canonical confirmed payment, exactly one booking,
    // owner-verified mapping and a fresh complete machine observation.
    const sources = await tx.execute(sql`
      SELECT p.id FROM sport_center.sport_membership_payments p
      JOIN sport_center.sport_bookings b ON b.membership_payment_id=p.id
      WHERE p.membership_id=${input.membershipId} AND p.status='confirmed'
        AND p.amount>0 AND p.confirmed_at IS NOT NULL
      GROUP BY p.id HAVING count(b.id)=1 LIMIT 1`);
    if (!sources.rows.length) return "held";
    const rows = await tx.execute(sql`
      SELECT map.user_pin,u.device_uid,u.display_name,u.device_role,
             a.observed_at,a.user_count,a.users
      FROM sport_center.gym_x904_member_mapping map
      JOIN sport_center.gym_x904_lan_users u
        ON u.device_serial=map.device_serial AND u.user_pin=map.user_pin
      JOIN sport_center.gym_x904_lan_state s ON s.device_serial=map.device_serial
        AND s.last_snapshot_id=u.last_seen_snapshot
      JOIN LATERAL (
        SELECT observed_at,user_count,users FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial=map.device_serial ORDER BY observed_at DESC LIMIT 1
      ) a ON true
      WHERE map.membership_id=${input.membershipId} AND map.status='verified'
        AND map.device_serial='TDBD234200545' AND map.user_pin='200'
        AND u.device_uid=337 AND u.device_role=0 LIMIT 1`);
    if (rows.rows.length !== 1) return "held";
    const x=rows.rows[0];
    const users=Array.isArray(x.users)?x.users:[];
    const entry=users.find((v:any)=>String(v.pin)==="200" && Number(v.uid)===337 &&
      v.name==="TEST SUSPEND X904" && Number(v.role)===0);
    const stamp=new Date(String(x.observed_at)).getTime();
    const decision=planX904PaymentTestCommand({
      membershipId:input.membershipId,pin:String(x.user_pin),uid:Number(x.device_uid),
      name:String(x.display_name),role:Number(x.device_role),
      mappingVerified:true,snapshotComplete:users.length===Number(x.user_count),
      snapshotFresh:Number.isFinite(stamp) && Date.now()>=stamp && Date.now()-stamp<=300000,
      canonicalConfirmedPayment:true,entitlement:input.entitlement,
      currentGroup:Number(entry?.group),eventKey:input.eventKey,enabled:true
    });
    if (!decision) return "held";
    const result=await tx.execute(sql`
      INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
      VALUES ('TDBD234200545',${decision.commandType},'200',
        ${JSON.stringify({expectedUid:337,expectedName:"TEST SUSPEND X904",source:"DEV_PAYMENT_TEST",membershipId:input.membershipId})}::jsonb,
        NULL,${decision.idempotencyKey})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING command_id`);
    return result.rows.length ? "queued" : "duplicate";
  });
}
