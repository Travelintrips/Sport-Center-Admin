import { extractBookingDpp } from "../accountingMath";
import { resolvePublicPaymentAccount } from "../publicPaymentAccount";

describe("payment accounting for inclusive PPN", () => {
  test("SC-0015 keeps DPP, PPN, and grand total balanced", () => {
    const amounts = extractBookingDpp({
      totalPrice: 219820,
      dpp: 200000,
      ppnAmount: 19820,
      grandTotal: 219820,
    });

    expect(amounts).toMatchObject({
      dpp: 200000,
      ppnAmount: 19820,
      ppnCollectedByCustomer: false,
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

    expect(amounts).toMatchObject({
      dpp: 200000,
      ppnAmount: 19820,
      ppnCollectedByCustomer: false,
    });
  });
});

describe("canonical Sport Center public payment account mapping", () => {
  test("direct/manual bank transfer uses Bank Mandiri Ciputat", () => {
    expect(resolvePublicPaymentAccount("Transfer Bank", "unknown")).toEqual({
      code: "1-1023-CST",
      name: "Bank Mandiri Ciputat",
      label: "Transfer Bank",
    });
  });

  test("QRIS uses payment clearing", () => {
    expect(resolvePublicPaymentAccount("QRIS", "manual")).toEqual({
      code: "1-1024-CST",
      name: "Payment Clearing Sport Center / QRIS CST",
      label: "QRIS",
    });
  });

  test("known payment provider uses payment clearing even when the method text is generic", () => {
    expect(resolvePublicPaymentAccount("Transfer Bank", "mandiri_direct")).toEqual({
      code: "1-1024-CST",
      name: "Payment Clearing Sport Center / QRIS CST",
      label: "QRIS",
    });
  });

  test("cash uses Kas Besar CST", () => {
    expect(resolvePublicPaymentAccount("Tunai", "manual")).toEqual({
      code: "1-1010-CST",
      name: "Kas Besar CST",
      label: "Cash",
    });
  });

  test("never falls back to retired 1-1020-CST", () => {
    expect(resolvePublicPaymentAccount(undefined, undefined).code).toBe("1-1023-CST");
  });
});
