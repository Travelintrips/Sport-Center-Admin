import { describe, expect, it } from "@jest/globals";
import {
  generatePaymentProofShortCode,
  isValidPaymentProofShortCode,
} from "./paymentProofShortLink";

describe("payment proof short links", () => {
  it("generates URL-safe 8-character codes", () => {
    for (let i = 0; i < 20; i += 1) {
      const code = generatePaymentProofShortCode();
      expect(code).toHaveLength(8);
      expect(isValidPaymentProofShortCode(code)).toBe(true);
    }
  });

  it("rejects malformed public proof codes", () => {
    expect(isValidPaymentProofShortCode("1234567")).toBe(false);
    expect(isValidPaymentProofShortCode("123456789")).toBe(false);
    expect(isValidPaymentProofShortCode("abcd!234")).toBe(false);
    expect(isValidPaymentProofShortCode("Ab_9-xY2")).toBe(true);
  });
});
