import { describe, expect, it } from "@jest/globals";
import {
  classifyPaymentMethod,
  parsePaymentProofAmount,
  parsePaymentProofDate,
  paymentProofDateMatchesBooking,
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

describe("payment proof OCR amount parsing", () => {
  it("reads Mandiri QRIS total Rp 200.000 as 200000, not 20000", () => {
    const rawText = [
      "QR Bayar",
      "Pembayaran Berhasil!",
      "Penerima Travelin.",
      "Detail Transaksi",
      "Total Transaksi Rp 200.000",
      "No. Referensi QRIS 609102309748",
      "Merchant PAN 9360084906137241838",
    ].join("\n");

    expect(parsePaymentProofAmount(rawText)).toBe(200000);
  });

  it("reads BCA-style Rp200.000,00 as 200000", () => {
    const rawText = [
      "Pembayaran QRIS Berhasil",
      "Rp200.000,00",
      "Pengakuisisi BCA",
      "Merchant PAN 936000801776324881",
    ].join("\n");

    expect(parsePaymentProofAmount(rawText)).toBe(200000);
  });

  it("supports international grouped format Rp 200,000.00", () => {
    expect(parsePaymentProofAmount("Total Transaksi Rp 200,000.00")).toBe(200000);
  });

  it("does not use reference or PAN identifiers as the amount", () => {
    const rawText = [
      "No. Referensi QRIS 609102309748",
      "Merchant PAN 9360084906137241838",
      "Total Transaksi Rp 200.000",
    ].join("\n");

    expect(parsePaymentProofAmount(rawText)).toBe(200000);
  });
});



describe("payment proof OCR date validation", () => {
  it("reads textual Mandiri receipt dates", () => {
    expect(parsePaymentProofDate("Pembayaran Berhasil!\n10 Sep 2026 · 18:49:26 WIB")).toBe("2026-09-10");
    expect(parsePaymentProofDate("22 September 2026 09:14 WIB")).toBe("2026-09-22");
    expect(parsePaymentProofDate("05 Okt 2026")).toBe("2026-10-05");
  });

  it("rejects a proof dated before the booking was created", () => {
    expect(
      paymentProofDateMatchesBooking(
        "2026-09-10",
        "2026-09-22T08:52:20.379Z",
        new Date("2026-09-22T09:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("accepts proof dates on or after the booking creation date and not in the future", () => {
    expect(
      paymentProofDateMatchesBooking(
        "2026-09-22",
        "2026-09-22T08:52:20.379Z",
        new Date("2026-09-22T09:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      paymentProofDateMatchesBooking(
        "2026-09-23",
        "2026-09-22T08:52:20.379Z",
        new Date("2026-09-22T09:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("returns null when OCR cannot read a date", () => {
    expect(paymentProofDateMatchesBooking(null, "2026-09-22T08:52:20.379Z")).toBeNull();
  });
});
