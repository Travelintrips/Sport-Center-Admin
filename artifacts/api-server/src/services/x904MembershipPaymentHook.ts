import { db, membershipPaymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { planX904MembershipReconciliation } from "./x904MembershipReconciliation";
import { recordX904MembershipReconciliation } from "./x904MembershipReconciliationWorker";

/**
 * Persist a payment-to-X904 reconciliation receipt after canonical confirmation.
 * Review-only until a trusted, fresh X904 SDK snapshot and verified ownership
 * can be checked. Never infer ownership from the machine's display name.
 * No device access, membership suspension, or user provisioning is performed.
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

  // DEV has no gym_x904_access_snapshots table yet. Do not fabricate SDK
  // evidence or query a missing table. Require an independent, audited
  // ownership-verification flow before a receipt may become ready.
  const plan = planX904MembershipReconciliation({
    membershipId: input.membershipId,
    membershipStart: input.startDate,
    membershipEnd: input.endDate,
    membershipStatus: input.membershipStatus,
    today: input.today,
    paymentSourcesComplete: true,
    payments: payments.map(p => ({
      id: p.id,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      status: p.status,
      amount: Number(p.amount),
    })),
    identity: null,
  });

  return recordX904MembershipReconciliation({
    membershipId: input.membershipId,
    deviceSerial: "TDBD234200545",
    plan,
  });
}
