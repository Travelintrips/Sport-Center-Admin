import { describe, expect, it } from "@jest/globals";
import {
  getPaymentReconciliationMissingFields,
  isPaymentReconciliationReady,
} from "./paymentReconciliationEligibility";

describe("payment reconciliation eligibility", () => {
  it("requires payment method, provider name, and company id", () => {
    expect(getPaymentReconciliationMissingFields({
      paymentMethod: null,
      providerName: "unknown",
      companyId: null,
    })).toEqual(["payment_method", "provider_name", "company_id"]);
  });

  it("accepts complete payment metadata", () => {
    expect(isPaymentReconciliationReady({
      paymentMethod: "Transfer Bank",
      providerName: "Manual Transfer",
      companyId: 62,
    })).toBe(true);
  });

  it("does not treat zero or non-numeric company ids as valid", () => {
    expect(getPaymentReconciliationMissingFields({
      paymentMethod: "Transfer Bank",
      providerName: "Manual Transfer",
      companyId: 0,
    })).toContain("company_id");
    expect(getPaymentReconciliationMissingFields({
      paymentMethod: "Transfer Bank",
      providerName: "Manual Transfer",
      companyId: Number.NaN,
    })).toContain("company_id");
  });
});