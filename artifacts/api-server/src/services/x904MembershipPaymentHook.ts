import { db, membershipPaymentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { planX904MembershipReconciliation } from "./x904MembershipReconciliation";
import { recordX904MembershipReconciliation } from "./x904MembershipReconciliationWorker";

/**
 * Explicit opt-in payment confirmation hook.
 * Produces a review-only reconciliation receipt, not a device command.
 * Identity is deliberately NOT inferred from matching names.
 *
 * To progress a receipt to verified, an authorized operator must separately
 * attest PIN/UID ownership and freshness of a trusted SDK snapshot.
 */
export async function onConfirmedMembershipPaymentX904(input: {
  membershipId: number;
  startDate: string;
  endDate: string;
  membershipStatus: string;
  today: string;
}): Promise<"created" | "duplicate" | "disabled" | "review_required"> {
  if (process.env.GYM_X904_MEMBERSHIP_RECONCILIATION_ENABLED !== "true") return "disabled";
  const payments = await db.select().from(membershipPaymentsTable)
    .where(eq(membershipPaymentsTable.membershipId, input.membershipId));
  if (!payments.some(p => p.status === "confirmed" && Number(p.amount) > 0)) {
    return "review_required";
  }
  // Ownership must already have been approved; machine-name matching is never
  // sufficient. A fresh authenticated SDK roster must also agree with PIN/UID.
  const identityRows = await db.execute(sql`
    WITH snapshot AS (
      SELECT observed_at, users
      FROM sport_center.gym_x904_access_snapshots
      WHERE device_serial='TDBD234200545'
      ORDER BY snapshot_id DESC LIMIT 1
    )
    SELECT mapping.user_pin, machine.device_uid
    FROM sport_center.gym_x904_member_mapping mapping
    JOIN sport_center.gym_x904_lan_users machine
      ON machine.device_serial=mapping.device_serial AND machine.user_pin=mapping.user_pin
    CROSS JOIN snapshot
    WHERE mapping.device_serial='TDBD234200545'
      AND mapping.membership_id=${input.membershipId}
      AND mapping.status='verified'
      AND mapping.verified_at IS NOT NULL
      AND machine.device_role=0 AND machine.device_uid BETWEEN 1 AND 65534
      AND snapshot.observed_at <= now()
      AND snapshot.observed_at > now() - interval '5 minutes'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(snapshot.users) usr
        WHERE usr->>'pin'=mapping.user_pin
          AND (usr->>'uid') ~ '^[0-9]+
    membershipId: input.membershipId,
    membershipStart: input.startDate,
    membershipEnd: input.endDate,
    membershipStatus: input.membershipStatus,
    today: input.today,
    paymentSourcesComplete: true,
    payments: payments.map(p => ({
      id: p.id, periodStart: p.periodStart, periodEnd: p.periodEnd,
      status: p.status, amount: Number(p.amount),
    })),
    identity, // Only approved mapping with fresh SDK PIN/UID readback.
  });
  return recordX904MembershipReconciliation({
    membershipId: input.membershipId,
    deviceSerial: "TDBD234200545",
    plan,
  });
}

          AND (usr->>'uid')::integer=machine.device_uid
          AND usr->>'name'=machine.display_name
          AND (usr->>'role')='0'
      )
    LIMIT 2
  `);
  const identity = identityRows.rows.length===1 ? {
    membershipId: input.membershipId,
    userPin: String(identityRows.rows[0].user_pin),
    deviceUid: Number(identityRows.rows[0].device_uid),
    deviceSerial: "TDBD234200545",
    status: "verified" as const,
    snapshotFresh: true,
    matchesSdk: true,
    uniqueMembership: true,
  } : null;
  const plan = planX904MembershipReconciliation({
    membershipId: input.membershipId,
    membershipStart: input.startDate,
    membershipEnd: input.endDate,
    membershipStatus: input.membershipStatus,
    today: input.today,
    paymentSourcesComplete: true,
    payments: payments.map(p => ({
      id: p.id, periodStart: p.periodStart, periodEnd: p.periodEnd,
      status: p.status, amount: Number(p.amount),
    })),
    identity: null, // No auto-verification based on machine name.
  });
  return recordX904MembershipReconciliation({
    membershipId: input.membershipId,
    deviceSerial: "TDBD234200545",
    plan,
  });
}
