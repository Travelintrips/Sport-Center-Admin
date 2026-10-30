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

export type GymEntitlement = "active" | "grace_period" | "suspended" | "review_required";

/** End date is inclusive; seven full calendar days follow before suspension. */
export function isWithinGymGracePeriod(endDate: string, today: string): boolean {
  if (!validDay(endDate) || !validDay(today)) return false;
  const end = Date.parse(endDate + "T00:00:00Z");
  const current = Date.parse(today + "T00:00:00Z");
  return current <= end + 7 * 86400000;
}

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
  if (isWithinGymGracePeriod(membershipEnd, today)) return membershipEnd < today ? "grace_period" : "active";
  // Unreconciled active membership records may be legacy imports. Never
  // suspend them solely because their end_date is old until sources are complete.
  return "suspended";
}

/** Renewal always starts after the previous expiry while active or in grace.
 * A lapsed record beyond grace restarts on the Jakarta-local request date.
 * This is a pure calendar rule shared by every gym membership renewal.
 */
export function resolveGymRenewalStart(status: string, previousEnd: string, today: string): string {
  if (!validDay(previousEnd) || !validDay(today)) throw new Error('INVALID_RENEWAL_DATE');
  if (status === 'active' && isWithinGymGracePeriod(previousEnd, today)) {
    return new Date(Date.parse(previousEnd + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  return today;
}

/**
 * Strict, fail-closed entitlement for AUTOMATED X904 mutations only.
 * Unlike the legacy UI-facing status, a membership date alone cannot activate
 * the device. Grace is a hold state, never a new activation authorization.
 */
export function resolvePaidX904Automation(input: Parameters<typeof resolveGymEntitlement>[0]): GymEntitlement {
  const decision = resolveGymEntitlement(input);
  if (decision === "review_required" || decision === "suspended") return decision;
  const covered = input.payments.some(p =>
    p.status === "confirmed" && p.amount > 0 &&
    p.periodStart <= input.today && p.periodEnd >= input.today
  );
  if (decision === "active" && !covered) return "review_required";
  return decision;
}
