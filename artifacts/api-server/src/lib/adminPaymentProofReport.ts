export type AdminProofReportEntry = { label: string; amount: number; url: string };

/** Informational proof report for an authorized admin upload. Never ask
 * WhatsApp group members to approve a payment that admin is confirming. */
export function buildAdminPaymentProofReport(input: {
  groupRef?: string | null;
  orderNumber: string;
  paymentId: number;
  proofs: AdminProofReportEntry[];
}): string {
  if (!input.proofs.length || input.proofs.some((p) => !p.url.trim())) {
    throw new Error("ADMIN_PAYMENT_PROOF_URL_REQUIRED");
  }
  const ref = input.groupRef || input.orderNumber;
  return [
    "📎 *Bukti Pembayaran — Admin*",
    "Grup/Booking: *" + ref + "*",
    "",
    "Tap link untuk lihat bukti:",
    ...input.proofs.map((p) =>
      p.label + " (Rp " + p.amount.toLocaleString("id-ID") + "): " + p.url
    ),
  ].join("\n");
}


/** Role must come from a validated authenticated session, not request body. */
export function isAuthorizedAdminProofUploader(
  actor: { role: string } | null,
): boolean {
  return actor != null &&
    ["owner", "super_admin", "admin", "finance", "admin_booking"].includes(actor.role);
}
