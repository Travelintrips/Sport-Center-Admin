export type PaymentReconciliationMetadata = {
  paymentMethod?: string | null;
  providerName?: string | null;
  companyId?: number | null;
};

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