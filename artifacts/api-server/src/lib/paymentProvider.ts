export const PAYMENT_PROVIDERS = ["mandiri_direct", "paylabs", "unknown"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export function normalizePaymentProvider(value: unknown): PaymentProvider | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  return (PAYMENT_PROVIDERS as readonly string[]).includes(normalized)
    ? normalized as PaymentProvider
    : null;
}

export function isTerminalBookingStatus(status: unknown): boolean {
  return ["cancelled", "expired", "rejected", "refunded"].includes(String(status ?? ""));
}

function validDate(value: unknown): Date | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Provider timestamps are only trusted when they parse to a real date and are
 * not materially in the future. Otherwise the server callback time is used.
 */
export function resolvePaylabsPaidAt(
  notification: Record<string, unknown> | null | undefined,
  callbackProcessedAt: Date,
): Date {
  const providerTimestampKeys = [
    "paidAt", "paid_at", "paymentTime", "payment_time", "paidTime", "paid_time",
    "successTime", "success_time", "transactionTime", "transaction_time",
    "tradeTime", "trade_time",
  ];
  const now = callbackProcessedAt.getTime();
  for (const key of providerTimestampKeys) {
    const candidate = validDate(notification?.[key]);
    if (candidate && candidate.getTime() <= now + 5 * 60 * 1000) return candidate;
  }
  return callbackProcessedAt;
}

export function resolvePaylabsProviderReference(
  notification: Record<string, unknown> | null | undefined,
  providerTradeNo: string,
): string | null {
  const keys = [
    "providerReference", "provider_reference", "reference", "referenceId",
    "reference_id", "transactionId", "transaction_id", "platformTradeNo",
    "paylabsTradeNo", "tradeNo",
  ];
  for (const key of keys) {
    const value = notification?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return providerTradeNo.trim() || null;
}