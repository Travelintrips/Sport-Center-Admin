import { extractBookingDpp } from "../accountingMath";

describe("payment accounting for inclusive PPN", () => {
  test("SC-0015 keeps DPP, PPN, and grand total balanced", () => {
    const amounts = extractBookingDpp({
      totalPrice: 219820,
      dpp: 200000,
      ppnAmount: 19820,
      grandTotal: 219820,
    });

    expect(amounts).toEqual({
      dpp: 200000,
      ppnAmount: 19820,
    });
    expect(amounts.dpp + amounts.ppnAmount).toBe(219820);
  });

  test("derives the correct DPP from an inclusive grand total when DPP is absent", () => {
    const amounts = extractBookingDpp({
      totalPrice: 219820,
      dpp: null,
      ppnAmount: 19820,
      grandTotal: 219820,
    });

    expect(amounts).toEqual({
      dpp: 200000,
      ppnAmount: 19820,
    });
  });
});