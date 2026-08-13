import { randomUUID } from "node:crypto";
import type { PaymentProvider } from "./paymentProvider";

/**
 * Every payment needs a stable provider identifier, including manual payments
 * that do not receive an ID from an external gateway.
 */
export function createPaymentProviderId(
  provider: PaymentProvider,
  supplied?: unknown,
): string {
  const value = supplied == null ? "" : String(supplied).trim();
  if (value) return value;
  return `internal-${provider}-${randomUUID()}`;
}

export function requirePaymentProviderId(
  provider: PaymentProvider,
  supplied?: unknown,
): string {
  const value = createPaymentProviderId(provider, supplied);
  if (!value.trim()) {
    throw new Error("PAYMENT_PROVIDER_ID_REQUIRED");
  }
  return value;
}

/**
 * Every payment also needs the provider's order identifier. Manual payments
 * do not receive one from an external gateway, so they get an internal,
 * traceable order identifier instead of a nullable value.
 */
export function createPaymentProviderOrderId(
  provider: PaymentProvider,
  supplied?: unknown,
): string {
  const value = supplied == null ? "" : String(supplied).trim();
  if (value) return value;
  return `internal-order-${provider}-${randomUUID()}`;
}

export function normalizeProviderName(provider: PaymentProvider): string {
  return provider.trim().toLowerCase();
}