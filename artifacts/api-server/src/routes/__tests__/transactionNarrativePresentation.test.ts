import { presentTransactionNarrative } from "../../../../sport-center/src/lib/transactionNarrative";

describe("Master Tabel transaction narrative presentation", () => {
  it("collapses identical description and notes", () => {
    expect(presentTransactionNarrative("Reimbush parkir", "Reimbush parkir")).toEqual({
      primary: "Reimbush parkir", additional: null,
    });
    expect(presentTransactionNarrative(" INPUT UANG MASUK SC - SIMULASI ", "input  uang masuk sc - simulasi")).toEqual({
      primary: "INPUT UANG MASUK SC - SIMULASI", additional: null,
    });
  });
  it("keeps distinct audit notes without overwriting description", () => {
    expect(presentTransactionNarrative("Pembelian alat GYM", "Biaya ditanggung kantor")).toEqual({
      primary: "Pembelian alat GYM", additional: "Biaya ditanggung kantor",
    });
  });
  it("shows a single available value and handles empty fields", () => {
    expect(presentTransactionNarrative("", "Reimburse EV")).toEqual({
      primary: "Reimburse EV", additional: null,
    });
    expect(presentTransactionNarrative(undefined, null)).toEqual({
      primary: "Tidak diisi", additional: null,
    });
  });
});
