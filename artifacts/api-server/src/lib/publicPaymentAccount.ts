export type PublicPaymentAccountLabel = "QRIS" | "Transfer Bank" | "Cash";

export type PublicPaymentAccount = {
  code: "1-1024-CST" | "1-1023-CST" | "1-1010-CST";
  name:
    | "Payment Clearing Sport Center / QRIS CST"
    | "Bank Mandiri Ciputat"
    | "Kas Besar CST";
  label: PublicPaymentAccountLabel;
};

/**
 * Canonical public debit-account mapping for Sport Center receipts.
 *
 * Keep this aligned with sport_center.create_payment_accounting_draft_owner():
 * - QRIS / known payment provider -> payment clearing
 * - cash / tunai -> cash
 * - direct/manual bank transfer -> Bank Mandiri Ciputat
 */
export function resolvePublicPaymentAccount(
  paymentMethod?: string | null,
  paymentProvider?: string | null,
): PublicPaymentAccount {
  const method = String(paymentMethod ?? "").trim().toLowerCase();
  const provider = String(paymentProvider ?? "").trim().toLowerCase();

  if (
    method.includes("qris") ||
    !["", "unknown", "manual"].includes(provider)
  ) {
    return {
      code: "1-1024-CST",
      name: "Payment Clearing Sport Center / QRIS CST",
      label: "QRIS",
    };
  }

  if (method.includes("cash") || method.includes("tunai")) {
    return {
      code: "1-1010-CST",
      name: "Kas Besar CST",
      label: "Cash",
    };
  }

  return {
    code: "1-1023-CST",
    name: "Bank Mandiri Ciputat",
    label: "Transfer Bank",
  };
}
