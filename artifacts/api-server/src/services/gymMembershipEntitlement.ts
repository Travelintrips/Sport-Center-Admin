/**
 * Conservative GYM entitlement policy.
 *
 * IMPORTANT: only a confirmed payment covering the evaluated date can grant
 * access. Booking/check-in rows are NOT payment proof. A pending proof upload
 * does not unlock a suspended member.
 *
 * This is deliberately pure; callers must reconcile all payment sources into
 * unique canonical periods before invoking it.
 */
export type GymPaymentPeriod = {
  id: string | number;
  periodStart: string;
  periodEnd: string;
  status: string;
  amount: number;
};

export type GymEntitlement = "active" | "suspended" | "review_required";

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string): boolean {
  if (!isoDay.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function resolveGymEntitlement(input: {
  today: string;
  membershipStart: string;
  membershipEnd: string;
  membershipStatus: string;
  payments: GymPaymentPeriod[];
  paymentSourcesComplete: boolean;
}): GymEntitlement {
  const { today, membershipStart, membershipEnd, membershipStatus, payments, paymentSourcesComplete } = input;
  if (!validDay(today) || !validDay(membershipStart) || !validDay(membershipEnd)) return "review_required";
  if (!paymentSourcesComplete) return "review_required";
  if (membershipStatus === "cancelled") return "suspended";
  if (membershipStart > membershipEnd) return "review_required";
  if (payments.some(p => !validDay(p.periodStart) || !validDay(p.periodEnd) || p.periodStart > p.periodEnd || !Number.isFinite(p.amount))) {
    return "review_required";
  }
  // A single confirmed, positive-value payment that covers today is sufficient.
  // A second pending renewal must not override a still-valid paid period.
  const covered = payments.some(p =>
    p.status === "confirmed" && p.amount > 0 &&
    p.periodStart <= today && p.periodEnd >= today
  );
  if (covered) return "active";
  // Unreconciled active membership records may be legacy imports. Never
  // suspend them solely because their end_date is old until sources are complete.
  return "suspended";
}
