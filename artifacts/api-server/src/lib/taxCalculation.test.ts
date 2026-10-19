import {
  calculateInclusiveInvoiceTax,
  calculateWithholdingTax,
  resolveBookingPpnTreatment,
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

describe("booking PPN policy", () => {
  test.each([true, false, null, undefined])(
    "personal bookings must never incur PPN (ppnEnabled=%s)",
    (enabled) => {
      const treatment = resolveBookingPpnTreatment("personal", enabled);
      expect(treatment).toBe("none");
    },
  );

  test("corporate booking retains PPN when enabled", () => {
    expect(resolveBookingPpnTreatment("company", true)).toBe("inclusive");
  });

  test("corporate booking does not have PPN when disabled", () => {
    expect(resolveBookingPpnTreatment("company", false)).toBe("none");
  });

  test("corporate booking legacy default remains enabled", () => {
    expect(resolveBookingPpnTreatment("company", null)).toBe("inclusive");
  });
});
