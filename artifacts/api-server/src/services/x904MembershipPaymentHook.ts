import { db, membershipPaymentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { planX904MembershipReconciliation } from "./x904MembershipReconciliation";
import { recordX904MembershipReconciliation } from "./x904MembershipReconciliationWorker";

/**
 * Persist a payment-to-X904 reconciliation receipt after canonical confirmation.
 * Review-only until a trusted, fresh X904 SDK snapshot and verified ownership
 * can be checked. Never infer ownership from the machine's display name.
 * No device access, membership suspension, or user provisioning is performed.
 */
export function hasCanonicalConfirmedMembershipPayments(
  confirmedPaymentIds: number[],
  linkedRows: Array<{ id: unknown; booking_count: unknown }>,
): boolean {
  if (!confirmedPaymentIds.length || linkedRows.length !== confirmedPaymentIds.length) return false;
  const expected = new Set(confirmedPaymentIds);
  if (expected.size !== confirmedPaymentIds.length) return false;
  const observed = new Set<string>();
  return linkedRows.every(row => {
    const id = String(row.id);
    if (!expected.has(Number(id)) || observed.has(id) || Number(row.booking_count) !== 1) return false;
    observed.add(id);
    return true;
  });
}

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

  const confirmed = payments.filter(p => p.status === "confirmed" && Number(p.amount) > 0 && p.confirmedAt !== null); 
  if (!confirmed.length) {
    return "review_required";
  }

  // A confirmed membership payment must have exactly one canonical booking.
  // Unlinked or ambiguously linked payments cannot produce an X904 receipt.
  const linked = await db.execute(sql`
    SELECT p.id, count(b.id)::integer AS booking_count
    FROM sport_center.sport_membership_payments p
    LEFT JOIN sport_center.sport_bookings b ON b.membership_payment_id = p.id
    WHERE p.membership_id = ${input.membershipId}
      AND p.status = 'confirmed' AND p.amount > 0 AND p.confirmed_at IS NOT NULL
    GROUP BY p.id
  `);
  const sourceComplete = hasCanonicalConfirmedMembershipPayments(confirmed.map(p => p.id), linked.rows);
  if (!sourceComplete) return "review_required";

  // DEV has no gym_x904_access_snapshots table yet. Do not fabricate SDK
  // evidence or query a missing table. Require an independent, audited
  // ownership-verification flow before a receipt may become ready.
  const plan = planX904MembershipReconciliation({
    membershipId: input.membershipId,
    membershipStart: input.startDate,
    membershipEnd: input.endDate,
    membershipStatus: input.membershipStatus,
    today: input.today,
    paymentSourcesComplete: sourceComplete,
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
