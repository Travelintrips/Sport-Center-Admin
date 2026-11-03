import { describe, expect, it } from "@jest/globals";
import {
  resolveEffectiveFacilityCompanyMapping,
  resolvePaymentCompanyEvidence,
} from "./paymentCompanyResolution.js";
import { computeCanonicalMdrSnapshot } from "./paymentEnrichment.js";

describe("deterministic payment company evidence", () => {
  it("resolves one company from validated evidence", () => {
    expect(resolvePaymentCompanyEvidence([
      {
        companyId: 24,
        companyCode: "DV",
        companyName: "PT Diva Servis",
        evidenceSource: "facility_ownership",
        evidenceReference: "facility_id:17",
      },
    ])).toEqual({
      companyId: 24,
      companyCode: "DV",
      companyName: "PT Diva Servis",
      evidenceSource: "facility_ownership",
      evidenceReference: "facility_ownership:facility_id:17",
      effectiveDate: null,
      deterministic: true,
      reason: "RESOLVED",
    });
  });

  it("accepts corroborating evidence for the same company", () => {
    const result = resolvePaymentCompanyEvidence([
      {
        companyId: 24,
        companyCode: "DV",
        companyName: "PT Diva Servis",
        evidenceSource: "booking_company_relation",
        evidenceReference: "company_customer_id:24",
      },
      {
        companyId: 24,
        companyCode: "DV",
        companyName: "PT Diva Servis",
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
      companyCode: null,
      companyName: null,
      evidenceSource: "none",
      evidenceReference: null,
      effectiveDate: null,
      deterministic: false,
      reason: "NO_OWNERSHIP_EVIDENCE",
    });
  });

  it("resolves the mapping effective on the payment date", () => {
    expect(resolveEffectiveFacilityCompanyMapping([
      { id: 1, facilityId: 1, companyId: 24, effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", isActive: true },
      { id: 2, facilityId: 1, companyId: 31, effectiveFrom: "2027-01-01", effectiveUntil: null, isActive: true },
    ], "2026-08-09")?.companyId).toBe(24);
    expect(resolveEffectiveFacilityCompanyMapping([
      { id: 1, facilityId: 1, companyId: 24, effectiveFrom: "2026-01-01", effectiveUntil: "2026-12-31", isActive: true },
      { id: 2, facilityId: 1, companyId: 31, effectiveFrom: "2027-01-01", effectiveUntil: null, isActive: true },
    ], "2027-08-09")?.companyId).toBe(31);
  });

  it("does not resolve overlapping mappings or inactive mappings", () => {
    expect(resolveEffectiveFacilityCompanyMapping([
      { id: 1, facilityId: 1, companyId: 24, effectiveFrom: "2026-01-01", effectiveUntil: null, isActive: true },
      { id: 2, facilityId: 1, companyId: 31, effectiveFrom: "2026-06-01", effectiveUntil: null, isActive: true },
    ], "2026-08-09")).toBeNull();
    expect(resolveEffectiveFacilityCompanyMapping([
      { id: 1, facilityId: 1, companyId: 24, effectiveFrom: "2026-01-01", effectiveUntil: null, isActive: false },
    ], "2026-08-09")).toBeNull();
  });
});

describe("canonical QRIS MDR snapshot", () => {
  it("applies zero MDR for approved Mandiri QRIS payments up to Rp100.000 from 1 Oct 2026", () => {
    expect(computeCanonicalMdrSnapshot({
      provider: "mandiri_direct",
      effectiveDate: "2026-10-30",
      configuredRate: 0.007,
      amount: 30000,
      source: "OWNER_APPROVED",
      calculationMethod: "percentage_of_gross",
      fixedProviderFee: 0,
      feeTaxRate: 0,
    })).toEqual({ mdrRate: 0, mdrAmount: 0, netAmount: 30000 });
  });

  it("applies 0.7% MDR above Rp100.000", () => {
    expect(computeCanonicalMdrSnapshot({
      provider: "mandiri_direct",
      effectiveDate: "2026-10-30",
      configuredRate: 0.007,
      amount: 320000,
      source: "OWNER_APPROVED",
      calculationMethod: "percentage_of_gross",
      fixedProviderFee: 0,
      feeTaxRate: 0,
    })).toEqual({ mdrRate: 0.007, mdrAmount: 2240, netAmount: 317760 });
  });

  it("does not apply the threshold to a non-approved rule", () => {
    expect(computeCanonicalMdrSnapshot({
      provider: "mandiri_direct",
      effectiveDate: "2026-10-30",
      configuredRate: 0.007,
      amount: 30000,
      source: "BANK_OBSERVED_EXCEPTION",
      calculationMethod: "percentage_of_gross",
      fixedProviderFee: 0,
      feeTaxRate: 0,
    })).toEqual({ mdrRate: 0.007, mdrAmount: 210, netAmount: 29790 });
  });
});
