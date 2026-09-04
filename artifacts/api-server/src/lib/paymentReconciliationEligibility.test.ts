import { describe, expect, it } from "@jest/globals";
import {
  FINAL_BANK_MATCH_STATUSES,
  getPaymentReconciliationMissingFields,
  isPaymentSettledAndMatched,
  isPaymentReconciliationReady,
  isFinalBankMatchStatus,
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

  it.each(FINAL_BANK_MATCH_STATUSES)(
    "marks a settled payment as reconciled for final mutation status %s",
    (status) => {
      expect(isFinalBankMatchStatus(status)).toBe(true);
      expect(isPaymentSettledAndMatched(
        { settlementStatus: "settled" },
        true,
      )).toBe(true);
    },
  );

  it("does not highlight a payment that is not settled", () => {
    for (const settlementStatus of [null, "unsettled", "pending", "SETTLING"]) {
      expect(isPaymentSettledAndMatched({ settlementStatus }, true)).toBe(false);
    }
  });

  it("does not highlight a settled payment without a final bank match", () => {
    expect(isPaymentSettledAndMatched({ settlementStatus: "settled" }, false)).toBe(false);
    expect(isFinalBankMatchStatus("need_review")).toBe(false);
    expect(isFinalBankMatchStatus("candidate")).toBe(false);
  });

  it("allows a booking with DP and pelunasan to highlight when either payment qualifies", () => {
    const payments = [
      { settlementStatus: "settled", hasFinalBankMatch: false },
      { settlementStatus: "unsettled", hasFinalBankMatch: true },
      { settlementStatus: "settled", hasFinalBankMatch: true },
    ];

    expect(
      payments.some((payment) =>
        isPaymentSettledAndMatched(payment, payment.hasFinalBankMatch),
      ),
    ).toBe(true);
  });
});