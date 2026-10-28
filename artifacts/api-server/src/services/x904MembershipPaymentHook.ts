import { db, membershipPaymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
