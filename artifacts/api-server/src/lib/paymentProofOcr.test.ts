import { describe, expect, it } from "@jest/globals";
import {
  classifyPaymentMethod,
  parsePaymentProofAmount,
  parsePaymentProofDate,
  parsePaymentProofRecipient,
  paymentProofDateMatchesBooking,
  paymentMethodMatchesOcr,
  paymentRecipientMatchesOcr,
  validatePaymentProofScan,
  type PaymentProofOcrScan,
} from "./paymentProofOcr";

function scanFromText(rawText: string): PaymentProofOcrScan {
  const classification = classifyPaymentMethod(rawText);
  return {
    ...classification,
    rawText,
    name: null,
    recipient: parsePaymentProofRecipient(rawText),
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

  it("reads a total when OCR drops the currency prefix and part of the label", () => {
    expect(parsePaymentProofAmount("Total Trai ! ~) 30.000")).toBe(30000);
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

describe("payment proof recipient validation", () => {
  it("reads QRIS and bank-transfer recipient labels", () => {
    expect(parsePaymentProofRecipient("Penerima Travelin.")).toBe("Travelin");
    expect(parsePaymentProofRecipient("Nama Penerima: PT Cahaya Sejati Teknologi")).toBe(
      "PT Cahaya Sejati Teknologi",
    );
    expect(parsePaymentProofRecipient("Merchant Name: Sport Center Soekarno-Hatta")).toBe(
      "Sport Center Soekarno-Hatta",
    );
    expect(
      parsePaymentProofRecipient("Pembayaran ke\nTRAVELIN BANDARA SOETTA"),
    ).toBe("TRAVELIN BANDARA SOETTA");
    expect(
      parsePaymentProofRecipient("Pembayal\nTRAVELIN BANDARA SOETTA\nTotal Transaksi Rp 30.000"),
    ).toBe("TRAVELIN BANDARA SOETTA");
    expect(
      parsePaymentProofRecipient("Total\nRp 30.000\nims, TRAVELIN BANDARA SOETTA\nJAKARTA PUSAT"),
    ).toBe("ims, TRAVELIN BANDARA SOETTA");
    expect(
      parsePaymentProofRecipient("Payment Successful\nTRAVELIN BANDARA SO...\nJAKARTA PUSAT"),
    ).toBe("TRAVELIN BANDARA SO");
  });

  it("matches normalized recipient names while rejecting a different recipient", () => {
    expect(
      paymentRecipientMatchesOcr("Cahaya Sejati Teknologi", ["PT. Cahaya Sejati Teknologi"]),
    ).toBe(true);
    expect(
      paymentRecipientMatchesOcr("TRAVELIN ANDARA SOETTAS", ["TRAVELIN BANDARA SOETTA"]),
    ).toBe(true);
    expect(paymentRecipientMatchesOcr("Travelin", ["Sport Center Soekarno-Hatta"])).toBe(false);
  });

  it("requires all four OCR checks to pass", () => {
    const scan = scanFromText([
      "Pembayaran QRIS Berhasil",
      "Penerima Travelin",
      "Total Transaksi Rp 200.000",
      "22 Sep 2026 09:14 WIB",
    ].join("\n"));
    scan.amount = parsePaymentProofAmount(scan.rawText);
    scan.date = parsePaymentProofDate(scan.rawText);

    const validation = validatePaymentProofScan({
      scan,
      selectedMethod: "QRIS",
      expectedAmount: 200000,
      expectedRecipients: ["Travelin", "Sport Center Soekarno-Hatta"],
      bookingCreatedAt: "2026-09-22T08:00:00.000Z",
      now: new Date("2026-09-22T12:00:00.000Z"),
    });
    expect(validation).toMatchObject({
      methodMatch: true,
      amountMatch: true,
      dateMatch: true,
      recipientMatch: true,
      complete: true,
    });

    const incomplete = validatePaymentProofScan({
      scan: { ...scan, recipient: null },
      selectedMethod: "QRIS",
      expectedAmount: 200000,
      expectedRecipients: ["Travelin"],
      bookingCreatedAt: "2026-09-22T08:00:00.000Z",
      now: new Date("2026-09-22T12:00:00.000Z"),
    });
    expect(incomplete.recipientMatch).toBe(false);
    expect(incomplete.complete).toBe(false);
  });
});
