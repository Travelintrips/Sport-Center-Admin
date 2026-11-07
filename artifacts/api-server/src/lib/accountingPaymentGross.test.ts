import { resolvePartialPaymentGrossAmount } from "./accountingPaymentGross";

describe("group DP and settlement GL posting", () => {
  it("uses 10 million paid for Falcons settlement, not 3.3 million child booking", () => {
    expect(resolvePartialPaymentGrossAmount({
      paymentType: "pelunasan", paymentAmount: 10000000,
      proposedGross: 3301200, ppnAmount: 0, pphAmount: 0,
    })).toBe(10000000);
  });
  it("also uses full group DP amount at initial posting", () => {
    expect(resolvePartialPaymentGrossAmount({
      paymentType: "dp", paymentAmount: 13933700,
      proposedGross: 3301200, ppnAmount: 0, pphAmount: 0,
    })).toBe(13933700);
  });
  it("does not rewrite taxable or full-payment snapshots", () => {
    expect(resolvePartialPaymentGrossAmount({
      paymentType: "pelunasan", paymentAmount: 1000,
      proposedGross: 1100, ppnAmount: 100, pphAmount: 0,
    })).toBe(1100);
    expect(resolvePartialPaymentGrossAmount({
      paymentType: "full_payment", paymentAmount: 1000,
      proposedGross: 1100, ppnAmount: 0, pphAmount: 0,
    })).toBe(1100);
  });
});
