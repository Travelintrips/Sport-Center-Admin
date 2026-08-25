import { normalizePaymentProvider } from "./paymentProvider";
import { normalizeProviderName } from "./paymentMetadata";

/**
 * Contract for the metadata-only payment edit.
 *
 * Only payment method and payment provider (plus the derived provider name)
 * may change. Every financial, status, settlement, or reconciliation field is
 * rejected explicitly so a caller can never smuggle a broad update through
 * this endpoint.
 */

const ALLOWED_FIELDS = new Set(["paymentMethod", "paymentProvider"]);

// Explicitly named so the error message tells the caller exactly what was
// rejected instead of a generic "unknown field".
const FORBIDDEN_FIELDS = new Set([
  "status",
  "amount",
  "paymentType",
  "notes",
  "paidAt",
  "confirmedAt",
  "companyId",
  "bankAccountId",
  "expectedSettlementDate",
  "settlementStatus",
  "providerId",
  "providerOrderId",
  "providerName",
  "providerReference",
  "providerTradeNo",
  "merchantTradeNo",
  "bookingId",
  "proofUrl",
  "ocrData",
]);

export type PaymentMetadataUpdateInput = {
  paymentMethod?: unknown;
  paymentProvider?: unknown;
} & Record<string, unknown>;

export type ValidatedPaymentMetadataUpdate = {
  paymentMethod?: string;
  paymentProvider?: string;
  providerName?: string;
};

export type PaymentMetadataValidationResult =
  | { ok: true; update: ValidatedPaymentMetadataUpdate }
  | { ok: false; error: string };

export function validatePaymentMetadataUpdate(
  body: unknown,
  current: { paymentMethod: string | null; paymentProvider: string | null },
): PaymentMetadataValidationResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body harus berupa objek JSON" };
  }
  const input = body as PaymentMetadataUpdateInput;

  for (const key of Object.keys(input)) {
    if (ALLOWED_FIELDS.has(key)) continue;
    if (FORBIDDEN_FIELDS.has(key)) {
      return {
        ok: false,
        error: `Field '${key}' tidak boleh diubah lewat update metadata pembayaran`,
      };
    }
    return { ok: false, error: `Field '${key}' tidak dikenal` };
  }

  const update: ValidatedPaymentMetadataUpdate = {};

  let normalizedMethod: string | undefined;
  if (input.paymentMethod !== undefined) {
    if (typeof input.paymentMethod !== "string" || !input.paymentMethod.trim()) {
      return { ok: false, error: "Metode pembayaran wajib diisi" };
    }
    normalizedMethod = input.paymentMethod.trim();
    if (normalizedMethod.length > 120) {
      return { ok: false, error: "Metode pembayaran terlalu panjang" };
    }
    update.paymentMethod = normalizedMethod;
  }

  const effectiveMethod = (normalizedMethod ?? current.paymentMethod ?? "")
    .trim()
    .toUpperCase();
  const isQris = effectiveMethod === "QRIS";

  if (input.paymentProvider !== undefined) {
    const normalizedProvider = normalizePaymentProvider(input.paymentProvider);
    if (!normalizedProvider || normalizedProvider === "unknown") {
      return { ok: false, error: "Provider pembayaran tidak valid." };
    }
    if (!isQris) {
      return { ok: false, error: "Provider hanya boleh diisi untuk pembayaran QRIS." };
    }
    // QRIS manual Sport Center selalu settle ke Bank Mandiri CST; provider
    // paylabs hanya sah bila memang berasal dari gateway. Edit metadata manual
    // tidak boleh memindahkan settlement, jadi QRIS dipaksa mandiri_direct.
    update.paymentProvider = "mandiri_direct";
  }

  if (normalizedMethod !== undefined) {
    if (isQris) {
      // Metode QRIS: provider SELALU mandiri_direct (settlement Bank Mandiri
      // CST), termasuk saat baris legacy masih menyimpan provider lain.
      update.paymentProvider = "mandiri_direct";
    } else {
      // Metode bukan QRIS: provider gateway tidak relevan lagi. Kolom
      // payment_provider NOT NULL, jadi nilai kanonisnya "unknown".
      update.paymentProvider = "unknown";
    }
  }

  if (update.paymentMethod === undefined && update.paymentProvider === undefined) {
    return { ok: false, error: "Tidak ada perubahan metadata pembayaran" };
  }

  if (typeof update.paymentProvider === "string") {
    update.providerName = normalizeProviderName(update.paymentProvider as any);
  }

  return { ok: true, update };
}
