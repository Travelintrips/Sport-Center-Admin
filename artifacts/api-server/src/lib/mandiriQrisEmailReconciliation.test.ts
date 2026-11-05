import { describe, expect, it } from "@jest/globals";
import {
  matchMandiriQrisEmailToPayments,
  parseMandiriQrisMerchantEmail,
  type MandiriQrisEmailPaymentCandidate,
} from "./mandiriQrisEmailReconciliation";

const email = `TRASAKSI BERHASIL
Nama Toko : TRAVELIN BANDARA SOETTA
Nama Acquirer : MANDIRI
Nomor Referensi : 630891709590
Tanggal Transaksi : 2026-11-04
Waktu Transaksi : 21:31:29
Pembayaran dari : BNI
Nama Customer : HILMY KHAIRY
Issuer RRN : f8616376f59d
Nominal Transaksi : 300,000.00
TIP : 0.00
Total: 300,000.00`;

function payment(overrides: Partial<MandiriQrisEmailPaymentCandidate> = {}): MandiriQrisEmailPaymentCandidate {
  return {
    id: 10,
    amount: 300_000,
    paymentMethod: "QRIS",
    paymentProvider: "mandiri_direct",
    providerReference: null,
    status: "pending",
    ...overrides,
  };
}

describe("Mandiri QRIS email reconciliation guard", () => {
  it("parses the real merchant notification format without PAN fields", () => {
    const parsed = parseMandiriQrisMerchantEmail(email);
    expect(parsed.valid).toBe(true);
    expect(parsed.reference).toBe("630891709590");
    expect(parsed.total).toBe(300_000);
    expect(parsed).not.toHaveProperty("customerPan");
    expect(parsed).not.toHaveProperty("merchantPan");
  });

  it("never auto-confirms even with exact provider reference + amount", () => {
    const result = matchMandiriQrisEmailToPayments(email, [
      payment({ providerReference: "630891709590" }),
    ]);
    expect(result.decision).toBe("REFERENCE_MATCH_REVIEW");
    expect(result.confidence).toBe("HIGH");
    expect(result.candidatePaymentIds).toEqual([10]);
    expect(result.autoConfirmEligible).toBe(false);
  });

  it("keeps amount-only matches in review", () => {
    const result = matchMandiriQrisEmailToPayments(email, [payment()]);
    expect(result.decision).toBe("AMOUNT_ONLY_REVIEW");
    expect(result.reason).toBe("AMOUNT_ONLY_NOT_AUTHORITATIVE");
    expect(result.autoConfirmEligible).toBe(false);
  });

  it("detects ambiguous identical amounts", () => {
    const result = matchMandiriQrisEmailToPayments(email, [
      payment({ id: 10 }),
      payment({ id: 11 }),
    ]);
    expect(result.decision).toBe("AMBIGUOUS_REVIEW");
    expect(result.candidatePaymentIds).toEqual([10, 11]);
  });

  it("rejects reference amount mismatch", () => {
    const result = matchMandiriQrisEmailToPayments(email, [
      payment({ amount: 250_000, providerReference: "630891709590" }),
    ]);
    expect(result.decision).toBe("AMBIGUOUS_REVIEW");
    expect(result.reason).toBe("REFERENCE_AMOUNT_MISMATCH");
  });

  it("excludes confirmed/non-Mandiri/non-QRIS payments", () => {
    const result = matchMandiriQrisEmailToPayments(email, [
      payment({ status: "confirmed" }),
      payment({ id: 11, paymentProvider: "paylabs" }),
      payment({ id: 12, paymentMethod: "Transfer Bank" }),
    ]);
    expect(result.decision).toBe("UNMATCHED");
    expect(result.candidatePaymentIds).toEqual([]);
  });

  it("fails closed on malformed or non-success notifications", () => {
    const result = matchMandiriQrisEmailToPayments(
      email.replace("TRASAKSI BERHASIL", "TRANSAKSI GAGAL"),
      [payment()],
    );
    expect(result.decision).toBe("INVALID");
    expect(result.autoConfirmEligible).toBe(false);
  });
});
