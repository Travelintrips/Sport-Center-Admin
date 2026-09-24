import {
  calculateInclusiveInvoiceTax,
  calculateWithholdingTax,
} from "./tax";

describe("company tax math", () => {
  test("Rp2.000.000 inclusive with PPh 10% reconciles exactly", () => {
    const tax = calculateInclusiveInvoiceTax(2_000_000);
    const pph = calculateWithholdingTax(tax.grandTotal, tax.dpp, true, 10);

    expect(tax.dpp).toBe(1_801_802);
    expect(tax.ppnAmount).toBe(198_198);
    expect(tax.dpp + tax.ppnAmount).toBe(2_000_000);
    expect(pph.amount).toBe(180_180);
    expect(pph.netAmount).toBe(1_819_820);
    expect(tax.dpp + tax.ppnAmount - pph.amount).toBe(pph.netAmount);
  });

  test("PPh is rounded DPP x 10%, not a line-sum approximation", () => {
    const tax = calculateInclusiveInvoiceTax(6_000_000);
    const pph = calculateWithholdingTax(tax.grandTotal, tax.dpp, true, 10);

    expect(tax.dpp).toBe(5_405_405);
    expect(tax.ppnAmount).toBe(594_595);
    expect(pph.amount).toBe(540_541);
    expect(pph.netAmount).toBe(5_459_459);
  });

  test("withholding disabled leaves net equal to gross", () => {
    const tax = calculateInclusiveInvoiceTax(2_700_000);
    const pph = calculateWithholdingTax(tax.grandTotal, tax.dpp, false, 10);

    expect(tax.dpp + tax.ppnAmount).toBe(2_700_000);
    expect(pph.amount).toBe(0);
    expect(pph.netAmount).toBe(2_700_000);
  });
});
