/** Nonmember access is independent of the one-hour walk-in booking tariff. */
export const NONMEMBER_ACCESS_MS = 12 * 60 * 60 * 1000;
export type NonmemberPaymentState = 'pending' | 'confirmed' | 'cancelled' | 'refunded';
export type NonmemberAccessDecision = 'hold' | 'activate' | 'suspend' | 'correct';
export function decideNonmemberX904Access(input: {
  verifiedNonmemberPin: boolean;
  confirmedPaymentAt: Date | null;
  paymentState: NonmemberPaymentState;
  currentGroup: number;
  now: Date;
}): NonmemberAccessDecision {
  if (!input.verifiedNonmemberPin || !Number.isFinite(input.now.getTime())) return 'hold';
  if (!input.confirmedPaymentAt || !Number.isFinite(input.confirmedPaymentAt.getTime())) return 'hold';
  const start = input.confirmedPaymentAt.getTime();
  const active = input.paymentState === 'confirmed' &&
    input.now.getTime() >= start && input.now.getTime() < start + NONMEMBER_ACCESS_MS;
  if (active) return input.currentGroup === 2 ? 'activate' : input.currentGroup === 1 ? 'correct' : 'hold';
  return input.currentGroup === 1 ? 'suspend' : input.currentGroup === 2 ? 'correct' : 'hold';
}
