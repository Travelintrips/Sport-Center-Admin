import { describe, expect, it } from "@jest/globals";
import { calculateEventDiscount } from "./bookingPricing";

describe("event booking pricing", () => {
  it("applies exactly 21.4% to a 100,000 base price", () => {
    expect(calculateEventDiscount(100_000)).toBe(21_400);
  });

  it("uses deterministic integer rounding for fractional rupiah results", () => {
    expect(calculateEventDiscount(101)).toBe(22);
    expect(calculateEventDiscount(1_000)).toBe(214);
  });
});