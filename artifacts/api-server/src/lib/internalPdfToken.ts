/**
 * internalPdfToken.ts
 * Dipakai oleh routes/invoices.ts (middleware) dan lib/invoiceDelivery.ts (header).
 * Token di-derive dari SESSION_SECRET — tidak perlu env var tambahan.
 */
import { createHmac } from "crypto";

export function getInternalPdfToken(): string {
  const secret = process.env.SESSION_SECRET ?? "fallback-pdf-secret-change-me";
  return createHmac("sha256", secret).update("internal-pdf-render").digest("hex");
}
