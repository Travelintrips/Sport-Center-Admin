/** Nonmember access is independent of the one-hour walk-in booking tariff. */
export const X904_AUTO_SUSPEND_EXEMPT_PINS = new Set(['237','79','12']);
export function isX904AutoSuspendExempt(pin: string, deviceRole: number): boolean {
  return deviceRole === 14 || deviceRole === 4 || X904_AUTO_SUSPEND_EXEMPT_PINS.has(pin);
}
export const NONMEMBER_ACCESS_MS = 12 * 60 * 60 * 1000;
/** Fixed WIB clock, for the current Sport Center opening hours: 06:00–23:00.
 * A 12-hour paid grant is a MAXIMUM, not permission to stay after closing.
 * There is no automatic reopening of the same grant the following morning.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const WIB_DAY_MS = 24 * 60 * 60 * 1000;
export const X904_GYM_OPEN_HOUR_WIB = 6;
export const X904_GYM_CLOSE_HOUR_WIB = 23;

/** Prevent a pending grant from becoming valid again on a later calendar day. */
export function x904NonmemberSameWibDate(a: Date, b: Date): boolean {
  const first = a.getTime();
  const second = b.getTime();
  return Number.isFinite(first) && Number.isFinite(second) &&
    Math.floor((first + WIB_OFFSET_MS) / WIB_DAY_MS) ===
    Math.floor((second + WIB_OFFSET_MS) / WIB_DAY_MS);
}

export function x904NonmemberOpeningHours(now: Date): boolean {
  const millis = now.getTime();
  if (!Number.isFinite(millis)) return false;
  const withinDay = ((millis + WIB_OFFSET_MS) % WIB_DAY_MS + WIB_DAY_MS) % WIB_DAY_MS;
  return withinDay >= X904_GYM_OPEN_HOUR_WIB * 60 * 60 * 1000 &&
    withinDay < X904_GYM_CLOSE_HOUR_WIB * 60 * 60 * 1000;
}

/** Return min(activation + 12h, 23:00 WIB on activation's local date).
 * An earlier stored expiry (e.g. refund/older grant) remains authoritative.
 */
export function x904NonmemberEffectiveExpiry(activatedAt: Date, storedExpiresAt?: Date | null): Date | null {
  const start = activatedAt.getTime();
  if (!Number.isFinite(start)) return null;
  const wibDateStartUtc = Math.floor((start + WIB_OFFSET_MS) / WIB_DAY_MS) * WIB_DAY_MS - WIB_OFFSET_MS;
  const closingUtc = wibDateStartUtc + X904_GYM_CLOSE_HOUR_WIB * 60 * 60 * 1000;
  const stored = storedExpiresAt?.getTime();
  const end = Math.min(start + NONMEMBER_ACCESS_MS, closingUtc,
    stored !== undefined && Number.isFinite(stored) ? stored : Number.POSITIVE_INFINITY);
  return new Date(end);
}

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
  if (isX904AutoSuspendExempt(input.userPin, input.deviceRole) ||
      !input.verifiedNonmemberPin || !Number.isFinite(input.now.getTime())) return 'hold';
  if (!input.confirmedPaymentAt || !Number.isFinite(input.confirmedPaymentAt.getTime())) return 'hold';
  const start = input.confirmedPaymentAt.getTime();
  const end = x904NonmemberEffectiveExpiry(input.confirmedPaymentAt)?.getTime();
  const active = input.paymentState === 'confirmed' &&
    x904NonmemberOpeningHours(input.now) &&
    end !== undefined && input.now.getTime() >= start && input.now.getTime() < end;
  if (active) return input.currentGroup === 2 ? 'activate' : input.currentGroup === 1 ? 'correct' : 'hold';
  if (isX904AutoSuspendExempt(input.userPin,input.deviceRole)) return 'hold';
  return input.currentGroup === 1 ? 'suspend' : input.currentGroup === 2 ? 'correct' : 'hold';
}
