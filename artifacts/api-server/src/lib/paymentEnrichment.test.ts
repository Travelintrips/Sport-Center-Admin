import { describe, expect, it } from "@jest/globals";
import { resolvePaymentCompanyEvidence } from "./paymentCompanyResolution.js";

describe("deterministic payment company evidence", () => {
  it("resolves one company from validated evidence", () => {
    expect(resolvePaymentCompanyEvidence([
      {
        companyId: 24,
        evidenceSource: "facility_ownership",
        evidenceReference: "facility_id:17",
      },
    ])).toEqual({
      companyId: 24,
      evidenceSource: "facility_ownership",
      evidenceReference: "facility_ownership:facility_id:17",
      deterministic: true,
    });
  });

  it("accepts corroborating evidence for the same company", () => {
    const result = resolvePaymentCompanyEvidence([
      {
        companyId: 24,
        evidenceSource: "booking_company_relation",
        evidenceReference: "company_customer_id:24",
      },
      {
        companyId: 24,
        evidenceSource: "booking_company_invoice",
        evidenceReference: "company_invoice_id:8",
      },
    ]);
    expect(result.companyId).toBe(24);
    expect(result.deterministic).toBe(true);
    expect(result.evidenceReference).toContain("company_invoice_id:8");
  });

  it("returns null for conflicting ownership evidence", () => {
    expect(resolvePaymentCompanyEvidence([
      {
        companyId: 24,
        evidenceSource: "facility_ownership",
        evidenceReference: "facility_id:17",
      },
      {
        companyId: 31,
        evidenceSource: "validated_explicit_configuration",
        evidenceReference: "merchant_id:2",
      },
    ])).toMatchObject({
      companyId: null,
      evidenceSource: "ambiguous",
      deterministic: false,
    });
  });

  it("returns null when no validated evidence exists", () => {
    expect(resolvePaymentCompanyEvidence([])).toEqual({
      companyId: null,
      evidenceSource: "none",
      evidenceReference: null,
      deterministic: false,
    });
  });
});