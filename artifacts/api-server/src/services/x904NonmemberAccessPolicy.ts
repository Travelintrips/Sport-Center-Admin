/** Nonmember access is independent of the one-hour walk-in booking tariff. */
export const X904_AUTO_SUSPEND_EXEMPT_PINS = new Set(['237','79','12']);
export function isX904AutoSuspendExempt(pin: string, deviceRole: number): boolean {
  return deviceRole === 14 || X904_AUTO_SUSPEND_EXEMPT_PINS.has(pin);
}
export const NONMEMBER_ACCESS_MS = 12 * 60 * 60 * 1000;
export type NonmemberPaymentState = 'pending' | 'confirmed' | 'cancelled' | 'refunded';
export type NonmemberAccessDecision = 'hold' | 'activate' | 'suspend' | 'correct';
export function decideNonmemberX904Access(input: {
  verifiedNonmemberPin: boolean;
  userPin: string;
  deviceRole: number;
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
  // Automatic-suspend exemption is deliberately narrow: it never disables
  // paid activation, and it does not alter the separate manual suspend route.
  if (isX904AutoSuspendExempt(input.userPin,input.deviceRole)) return 'hold';
  return input.currentGroup === 1 ? 'suspend' : input.currentGroup === 2 ? 'correct' : 'hold';
}
