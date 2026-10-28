/** Separate payment-event sheet contract: never reuse booking-level 14-column tabs. */
export const PAYMENT_EVENT_HEADERS = [
  "Source Key", "Source Type", "Booking ID", "Payment ID", "Allocation ID",
  "Company Invoice ID", "Membership Payment ID", "Payment Date WIB", "Amount IDR",
  "Validation Status",
] as const;

export type PaymentEventCandidate = {
  source_key: string;
  source_type: "direct" | "allocation" | "corporate_invoice" | "membership";
  booking_id: number | null;
  payment_id: number | null;
  allocation_id: number | null;
  company_invoice_id: number | null;
  membership_payment_id: number | null;
  payment_date_wib: string;
  amount: string;
  validation_status: string;
};

/** Reject ambiguous or unverified source events before any sheet or ledger writes. */
export function paymentEventRow(candidate: PaymentEventCandidate): string[] {
  const e = candidate;
  if (e.validation_status !== "CANDIDATE" || !/^\d{4}-\d{2}-\d{2}$/.test(e.payment_date_wib))
    throw new Error("EVENT_NOT_VALIDATED");
  if (!/^(?:payment:\d+:(?:booking:\d+|allocation:\d+:booking:\d+)|invoice:\d+:item:\d+:booking:\d+|membership_payment:\d+)$/.test(e.source_key))
    throw new Error("EVENT_SOURCE_KEY_INVALID");
  if (!/^\d+(?:\.\d{1,2})?$/.test(e.amount) || Number(e.amount) <= 0 || !Number.isSafeInteger(Math.round(Number(e.amount) * 100)))
    throw new Error("EVENT_AMOUNT_INVALID");
  const sourceOk =
    (e.source_type === "direct" && e.booking_id != null && e.payment_id != null && e.allocation_id == null && e.company_invoice_id == null && e.membership_payment_id == null && e.source_key === `payment:${e.payment_id}:booking:${e.booking_id}`) ||
    (e.source_type === "allocation" && e.booking_id != null && e.payment_id != null && e.allocation_id != null && e.company_invoice_id == null && e.membership_payment_id == null && e.source_key === `payment:${e.payment_id}:allocation:${e.allocation_id}:booking:${e.booking_id}`) ||
    (e.source_type === "corporate_invoice" && e.booking_id != null && e.payment_id == null && e.allocation_id == null && e.company_invoice_id != null && e.membership_payment_id == null && new RegExp(`^invoice:${e.company_invoice_id}:item:[0-9]+:booking:${e.booking_id}$`).test(e.source_key)) ||
    (e.source_type === "membership" && e.booking_id == null && e.payment_id == null && e.allocation_id == null && e.company_invoice_id == null && e.membership_payment_id != null && e.source_key === `membership_payment:${e.membership_payment_id}`);
  if (!sourceOk) throw new Error("EVENT_SOURCE_LINK_INVALID");
  return [e.source_key,e.source_type,e.booking_id,e.payment_id,e.allocation_id,e.company_invoice_id,e.membership_payment_id,e.payment_date_wib,e.amount,e.validation_status]
    .map(value => value == null ? "" : String(value));
}
