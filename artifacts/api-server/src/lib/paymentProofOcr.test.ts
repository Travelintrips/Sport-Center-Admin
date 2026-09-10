import { describe, expect, it } from "@jest/globals";
import {
  classifyPaymentMethod,
  paymentMethodMatchesOcr,
  type PaymentProofOcrScan,
} from "./paymentProofOcr";

function scanFromText(rawText: string): PaymentProofOcrScan {
  const classification = classifyPaymentMethod(rawText);
  return {
    ...classification,
    rawText,
    name: null,
    amount: null,
    date: null,
    engine: "tesseract",
    scannedAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("payment proof OCR method classification", () => {
  it("recognizes QRIS even when an acquiring bank is printed on the receipt", () => {
    const scan = scanFromText("QRIS pembayaran berhasil Bank Mandiri");

    expect(scan.paymentMethod).toBe("QRIS");
    expect(paymentMethodMatchesOcr("QRIS", scan)).toBe(true);
  });

  it("does not reject QRIS from an ambiguous recipient/success message", () => {
    const scan = scanFromText("Pembayaran berhasil ke Travelin Bandara Soekarno-Hatta");

    expect(scan.paymentMethod).toBe("unknown");
    expect(paymentMethodMatchesOcr("QRIS", scan)).toBeNull();
  });

  it("still rejects a QRIS selection when the receipt explicitly proves a bank transfer", () => {
    const scan = scanFromText("Transfer bank ke rekening BCA nomor rekening 1234567890");

    expect(scan.paymentMethod).toBe("Transfer Bank");
    expect(paymentMethodMatchesOcr("QRIS", scan)).toBe(false);
  });
});