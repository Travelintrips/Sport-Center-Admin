/** Nonmember access is independent of the one-hour walk-in booking tariff. */
export const X904_AUTO_SUSPEND_EXEMPT_PINS = new Set(['237','79','12']);
export function isX904AutoSuspendExempt(pin: string, deviceRole: number): boolean {
  return deviceRole === 14 || X904_AUTO_SUSPEND_EXEMPT_PINS.has(pin);
}
export const NONMEMBER_ACCESS_MS = 12 * 60 * 60 * 1000;
export const X904_NONMEMBER_CARD_ALIASES = {
  VIS001: { userPin: '78', deviceUid: 338, displayName: 'VIS 001' },
  VIS002: { userPin: '90', deviceUid: 339, displayName: 'VIS 002' },
  VIS003: { userPin: '13', deviceUid: 13, displayName: 'VIS 003' },
  VIS004: { userPin: '17', deviceUid: 17, displayName: 'VIS 004' },
  VIS005: { userPin: '11', deviceUid: 11, displayName: 'VIS 005' },
  VIS006: { userPin: '15', deviceUid: 15, displayName: 'VIS 006' },
} as const;
export type X904NonmemberCardAlias = keyof typeof X904_NONMEMBER_CARD_ALIASES;
export function resolveX904NonmemberCard(alias: string) {
  return Object.prototype.hasOwnProperty.call(X904_NONMEMBER_CARD_ALIASES, alias)
    ? X904_NONMEMBER_CARD_ALIASES[alias as X904NonmemberCardAlias]
    : null;
}
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
  if (isX904AutoSuspendExempt(input.userPin,input.deviceRole)) return 'hold';
  return input.currentGroup === 1 ? 'suspend' : input.currentGroup === 2 ? 'correct' : 'hold';
}
