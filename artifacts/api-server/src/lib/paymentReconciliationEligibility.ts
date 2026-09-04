export type PaymentReconciliationMetadata = {
  paymentMethod?: string | null;
  providerName?: string | null;
  companyId?: number | null;
};

export const FINAL_BANK_MATCH_STATUSES = [
  "auto_matched",
  "matched",
  "approved",
] as const;

export function isFinalBankMatchStatus(status?: string | null): boolean {
  return FINAL_BANK_MATCH_STATUSES.includes(
    String(status ?? "").trim().toLowerCase() as (typeof FINAL_BANK_MATCH_STATUSES)[number],
  );
}

export function isPaymentSettledAndMatched(
  payment: { settlementStatus?: string | null },
  hasFinalBankMatch: boolean,
): boolean {
  return (
    String(payment.settlementStatus ?? "").trim().toLowerCase() === "settled" &&
    hasFinalBankMatch
  );
}

export type ReconciliationPaymentReference = {
  id: number;
  bookingId: number;
};

export type ReconciliationBookingReference = {
  id: number;
  groupRef?: string | null;
};

export type ReconciliationMutationReference = {
  paymentId?: number | null;
  orderId?: number | null;
  status?: string | null;
};

/**
 * Resolves both direct payment matches and order/group matches to the
 * payment IDs used by the booking list highlight.
 */
export function getReconciledPaymentIds(
  payments: ReconciliationPaymentReference[],
  bookings: ReconciliationBookingReference[],
  mutations: ReconciliationMutationReference[],
): Set<number> {
  const reconciledPaymentIds = new Set<number>();
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const bookingIdsByGroupRef = new Map<string, number[]>();

  for (const booking of bookings) {
    if (!booking.groupRef) continue;
    const groupBookingIds = bookingIdsByGroupRef.get(booking.groupRef) ?? [];
    groupBookingIds.push(booking.id);
    bookingIdsByGroupRef.set(booking.groupRef, groupBookingIds);
  }

  for (const mutation of mutations) {
    if (!isFinalBankMatchStatus(mutation.status ?? null)) continue;
    if (mutation.paymentId != null) reconciledPaymentIds.add(mutation.paymentId);

    if (mutation.orderId == null) continue;
    const matchedBooking = bookingById.get(mutation.orderId);
    const matchedBookingIds = matchedBooking?.groupRef
      ? bookingIdsByGroupRef.get(matchedBooking.groupRef) ?? [matchedBooking.id]
      : [mutation.orderId];

    for (const payment of payments) {
      if (matchedBookingIds.includes(payment.bookingId)) {
        reconciledPaymentIds.add(payment.id);
      }
    }
  }

  return reconciledPaymentIds;
}

/**
 * Minimum metadata required before a payment may be used as a bank
 * reconciliation candidate. The matcher may still leave a valid payment in
 * review when amount/date/reference evidence is insufficient.
 */
export function getPaymentReconciliationMissingFields(
  payment: PaymentReconciliationMetadata,
): string[] {
  const missing: string[] = [];
  if (!payment.paymentMethod?.trim()) missing.push("payment_method");
  if (
    !payment.providerName?.trim() ||
    payment.providerName.trim().toLowerCase() === "unknown"
  ) {
    missing.push("provider_name");
  }
  if (
    payment.companyId == null ||
    !Number.isSafeInteger(Number(payment.companyId)) ||
    Number(payment.companyId) <= 0
  ) {
    missing.push("company_id");
  }
  return missing;
}

export function isPaymentReconciliationReady(
  payment: PaymentReconciliationMetadata,
): boolean {
  return getPaymentReconciliationMissingFields(payment).length === 0;
}