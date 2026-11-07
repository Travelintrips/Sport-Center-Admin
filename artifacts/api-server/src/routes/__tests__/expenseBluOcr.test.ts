import { parseBluProofDate, parseBluProofReference, parseBluExpenseAmount } from "../../lib/expenseBluProof";

describe("Blu receipts: expense OCR parsing regressions", () => {
  const prepaid = `Transaksi Berhasil
28 Okt 2026 | 14:53:14 WIB
Kode Token
2323 0937 7275 0481 1885
Total
Rp 100.000,00
DEDE YANI
PLN Prabayar
No. Ref blu
1793 1739 9432
5002 2230`;

  const transfer = `blu Transaksi Berhasil
Nominal
Rp 200.000,00
Reimbush charger ev
Felicia Justiani
DEDE SAEFULLAH
29 Okt 2026 15:25:02 WIB
Tipe Transaksi BI-FAST
No. Ref blu
1793 2623 0280 0488`;

  const pln = `STRUK PEMBELIAN LISTRIK PRABAYAR
NO METER 32193581751
NO REF
250117179317399432500
222300000000
RP BAYAR RP 102.750
PPN RP 0,00
TOTAL BAYAR RP 100.000`;

  it("reads 28 October, nominal Rp100.000 and full 20-digit blu reference", () => {
    expect(parseBluProofDate(prepaid)).toBe("2026-10-28");
    expect(parseBluExpenseAmount(prepaid)).toBe(100000);
    expect(parseBluProofReference(prepaid)).toBe("17931739943250022230");
  });

  it("reads 29 October, nominal Rp200.000 and 16-digit blu reference", () => {
    expect(parseBluProofDate(transfer)).toBe("2026-10-29");
    expect(parseBluExpenseAmount(transfer)).toBe(200000);
    expect(parseBluProofReference(transfer)).toBe("1793262302800488");
  });

  it("uses TOTAL BAYAR, not RP BAYAR, and never mislabels PLN reference as blu", () => {
    expect(parseBluExpenseAmount(pln)).toBe(100000);
    expect(parseBluProofReference(pln)).toBeNull();
    expect(parseBluProofDate(pln)).toBeNull();
  });

  it("does not parse token or meter number as a blu reference", () => {
    expect(parseBluProofReference("PLN Prabayar\\nKode Token\\n2323 0937 7275 0481 1885\\nNo Meter 32193581751")).toBeNull();
  });
});
