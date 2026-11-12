import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseBluProofDate, parseBluProofReference, parseBluExpenseAmount, parseBluProofDestinationBank, parseBluProofDestinationAccount, parseBluProofPurpose, parseBluTransferMethod, parseBluProofSourceBank, parseBluProofRecipient, selectCompleteBluReference } from "../../lib/expenseBluProof";

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

  it("reconstructs blu reference wrapped after twelve digits instead of truncating",()=>{
    const wrapped="Transaksi Berhasil\nNo. Ref blu\n1793 2623 0280\n0488\nPunya masalah dengan transaksi ini?";
    expect(parseBluProofReference(wrapped)).toBe("1793262302800488");
  });
  it("reassembles a split reference when the last OCR row has an icon label",()=>{
    const sample=["No. Ref blu","1793 2623 0280","0488 Copy"].join("\n");
    expect(parseBluProofReference(sample)).toBe("1793262302800488");
  });
  it("keeps an incomplete blu reference empty",()=>{
    const sample=["No. Ref blu","1793 2623 0280","Lihat bukti"].join("\n");
    expect(parseBluProofReference(sample)).toBeNull();
  });
  it("reads blu ref when OCR splits the label itself across lines",()=>{
    const transfer=["No. Ref","blu","1793 2623 0280","0488"].join("\n");
    const prepaid=["No. Ref","blu","1793 1739 9432","5002 2230"].join("\n");
    expect(parseBluProofReference(transfer)).toBe("1793262302800488");
    expect(parseBluProofReference(prepaid)).toBe("17931739943250022230");
  });
  it("does not treat PLN provider NO REF or token as blu reference",()=>{
    const provider=["NO REF","250117179317399432500","222300000000"].join("\n");
    const token=["Kode Token","2323 0937 7275 0481 1885"].join("\n");
    expect(parseBluProofReference(provider)).toBeNull();
    expect(parseBluProofReference(token)).toBeNull();
  });
  it("scans multiple blu proof image regions before optional vision",()=>{
    const scanner=readFileSync(resolve(process.cwd(),"src/lib/paymentProofOcr.ts"),"utf8");
    const blu=readFileSync(resolve(process.cwd(),"src/lib/expenseBluProof.ts"),"utf8");
    expect(scanner).toContain("[[0.26,0.75],[0.49,0.94]]");
    expect(blu).toContain("meta.height*0.24");
  });
  it("rejects incomplete OCR prefixes and conflicting vision suggestions",()=>{
    expect(parseBluProofReference("No. Ref blu\n1793 2623 0280\nPunya masalah dengan transaksi ini?")).toBeNull();
    expect(selectCompleteBluReference("179326230280",null)).toBeNull();
    expect(selectCompleteBluReference(null,"1793262302800488")).toBe("1793262302800488");
    expect(selectCompleteBluReference("1793262302800488","1793262302809999")).toBeNull();
    expect(selectCompleteBluReference("1793262302800488","1793262302800488")).toBe("1793262302800488");
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

describe("expense proof empty OCR response is recoverable without duplicate upload", () => {
  it("keeps the uploaded file and exposes a retry instead of silently reporting success", () => {
    const route=readFileSync(resolve(process.cwd(),"src/routes/expenses.ts"),"utf8");
    const ocr=readFileSync(resolve(process.cwd(),"src/lib/paymentProofOcr.ts"),"utf8");
    const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
    expect(route).toContain('readStatus: readableFields === 0 ? "no_fields"');
    expect(route).toContain("fieldCount: 0");
    expect(ocr).toContain('(["color", "normalized", "inverted"] as const)');
    expect(ui).toContain("Coba Baca Lagi (tanpa unggah ulang)");
    expect(ui).toContain("lastProofFileRef.current=firstProof");
    expect(ui).toContain('setProofReadMessage(preview.readMessage');
  });
});

describe("blu expense field extraction is separate from bank verification",()=>{
  const raw=[
    "blu Transaksi Berhasil",
    "29 Okt 2026 | 15:25:02 WIB",
    "Nominal",
    "Rp 200.000,00",
    '"Reimbush charger ev"',
    "Felicia Justiani",
    "bluAccount",
    "DEDE SAEFULLAH",
    "BCA - 8881 5220 55",
    "Tipe Transaksi",
    "BI-FAST",
    "No. Ref blu",
    "1793 2623 0280 0488"
  ].join("\n");
  it("reads beneficiary destination, memo and BI-FAST without guessing from source",()=>{
    expect(parseBluProofDestinationBank(raw)).toBe("BCA");
    expect(parseBluProofDestinationAccount(raw)).toBe("8881522055");
    expect(parseBluProofPurpose(raw)).toBe("Reimbush charger ev");
    expect(parseBluTransferMethod(raw)).toBe("BI-FAST");
    expect(parseBluProofSourceBank(raw)).toBe("blu by BCA Digital");
    expect(parseBluProofRecipient(raw)).toBe("DEDE SAEFULLAH");
  });
  it("never invents beneficiary metadata from a bare amount or source bank",()=>{
    const incomplete="Nominal\nRp 200.000,00\nbluAccount";
    expect(parseBluProofDestinationBank(incomplete)).toBeNull();
    expect(parseBluProofDestinationAccount(incomplete)).toBeNull();
    expect(parseBluProofPurpose(incomplete)).toBeNull();
    expect(parseBluTransferMethod(incomplete)).toBeNull();
  });
});
