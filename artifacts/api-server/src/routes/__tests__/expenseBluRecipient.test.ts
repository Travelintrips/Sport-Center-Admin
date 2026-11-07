import { parseBluProofRecipient } from "../../lib/expenseBluProof";
describe("blu expense recipient extraction", () => {
  it("recognizes transfer destination not source owner", () => {
    const raw = `Transaksi Berhasil
Nominal
Rp 200.000,00
"Reimbush charger ev"
Felicia Justiani
bluAccount
DEDE SAEFULLAH
BCA - 8881 5220 55
29 Okt 2026 15:25:02 WIB
Tipe Transaksi
BI-FAST
No. Ref blu
1793 2623 0280 0488`;
    expect(parseBluProofRecipient(raw)).toBe("DEDE SAEFULLAH");
  });
  it("recognizes PLN account holder above meter information", () => {
    const raw = `Transaksi Berhasil
28 Okt 2026 | 14:53:14 WIB
Total
Rp 100.000,00
DEDE YANI
32193581751 - R2/3500VA
Tipe Transaksi
PLN Prabayar`;
    expect(parseBluProofRecipient(raw)).toBe("DEDE YANI");
  });
  it("does not guess recipient from source owner or misc receipt text", () => {
    expect(parseBluProofRecipient(`Nominal
Rp 200.000,00
Felicia Justiani
bluAccount
Tipe Transaksi BI-FAST`)).toBeNull();
    expect(parseBluProofRecipient("No. Ref blu\\n1793262302800488\\nKode Token 2323 0937 7275")).toBeNull();
  });
});
