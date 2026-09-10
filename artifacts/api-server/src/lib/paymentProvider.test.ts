import { describe, expect, it } from "@jest/globals";
import {
  isTerminalBookingStatus,
  normalizePaymentProvider,
  resolveManualPaymentPaidAt,
  resolvePaylabsPaidAt,
  resolvePaylabsProviderReference,
} from "./paymentProvider.js";

describe("canonical payment provider rules", () => {
  it("accepts only the canonical provider values", () => {
    expect(normalizePaymentProvider("mandiri_direct")).toBe("mandiri_direct");
    expect(normalizePaymentProvider(" PAYLABS ")).toBe("paylabs");
    expect(normalizePaymentProvider("unknown")).toBe("unknown");
    expect(normalizePaymentProvider("qris")).toBeNull();
  });

  it("recognizes every terminal booking status", () => {
    expect(["cancelled", "expired", "rejected", "refunded"].every(isTerminalBookingStatus)).toBe(true);
    expect(isTerminalBookingStatus("pending_payment")).toBe(false);
  });

  it("uses a valid provider success timestamp and falls back to callback time", () => {
    const callbackAt = new Date("2026-08-08T10:00:00.000Z");
    expect(resolvePaylabsPaidAt(
      { paidAt: "2026-08-08T09:59:00.000Z" },
      callbackAt,
    ).toISOString()).toBe("2026-08-08T09:59:00.000Z");
    expect(resolvePaylabsPaidAt({ paidAt: "not-a-date" }, callbackAt)).toBe(callbackAt);
  });

  it("always gives manual payments an effective timestamp", () => {
    const submittedAt = new Date("2026-08-30T17:30:00.000Z");
    expect(resolveManualPaymentPaidAt({}, submittedAt)).toBe(submittedAt);
    expect(resolveManualPaymentPaidAt(
      { paidAt: "2026-08-30T17:29:00.000Z" },
      submittedAt,
    ).toISOString()).toBe("2026-08-30T17:29:00.000Z");
  });

  it("prefers the provider reference and falls back to provider trade number", () => {
    expect(resolvePaylabsProviderReference(
      { transactionId: "TX-123" },
      "PL-123",
    )).toBe("TX-123");
    expect(resolvePaylabsProviderReference({}, "PL-123")).toBe("PL-123");
  });
});