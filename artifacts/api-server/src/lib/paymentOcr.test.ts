import { describe, expect, it } from "@jest/globals";
import {
  detectPaymentMethodFromOcr,
  PAYMENT_METHOD_OCR_THRESHOLD,
} from "./paymentOcr";

describe("detectPaymentMethodFromOcr", () => {
  it("detects QRIS with high confidence", () => {
    const result = detectPaymentMethodFromOcr("Pembayaran berhasil QRIS Rp 250.000");

    expect(result.paymentMethod).toBe("QRIS");
    expect(result.highConfidence).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(PAYMENT_METHOD_OCR_THRESHOLD);
  });

  it("detects a bank and preserves the bank-specific label", () => {
    const result = detectPaymentMethodFromOcr(
      "Transfer berhasil ke BCA 1234567890 nominal Rp 500.000",
    );

    expect(result.paymentMethod).toBe("Transfer Bank BCA");
    expect(result.bank).toBe("BCA");
    expect(result.highConfidence).toBe(true);
  });

  it("detects the configured Mandiri account even when the bank name is missing", () => {
    const result = detectPaymentMethodFromOcr(
      "Transfer berhasil ke 1640006707220 Rp 100.000",
    );

    expect(result.paymentMethod).toBe("Transfer Bank Mandiri");
    expect(result.confidence).toBe(0.99);
  });

  it("detects EDC debit receipts and wallets", () => {
    expect(detectPaymentMethodFromOcr("EDC DEBIT PURCHASE").paymentMethod).toBe("Debit/Kredit");
    expect(detectPaymentMethodFromOcr("Top up GoPay berhasil").paymentMethod).toBe("GoPay");
    expect(detectPaymentMethodFromOcr("OVO payment berhasil").paymentMethod).toBe("OVO");
  });

  it("does not auto-apply an ambiguous bank mention", () => {
    const result = detectPaymentMethodFromOcr("Bank");

    expect(result.paymentMethod).toBe("Transfer Bank");
    expect(result.highConfidence).toBe(true);
  });

  it("returns no classification for unrelated OCR text", () => {
    const result = detectPaymentMethodFromOcr("Terima kasih telah berbelanja");

    expect(result.paymentMethod).toBeNull();
    expect(result.highConfidence).toBe(false);
  });
});