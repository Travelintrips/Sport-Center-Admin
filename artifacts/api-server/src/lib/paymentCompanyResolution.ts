export type PaymentCompanyEvidenceSource =
  | "source_payment_company"
  | "booking_company_relation"
  | "booking_company_invoice"
  | "validated_explicit_configuration"
  | "facility_company_mapping"
  | "facility_ownership";

export type PaymentCompanyEvidence = {
  companyId: number;
  evidenceSource: PaymentCompanyEvidenceSource;
  evidenceReference: string;
  effectiveDate?: string | null;
};

export type PaymentCompanyResolution = {
  companyId: number | null;
  evidenceSource: PaymentCompanyEvidenceSource | "ambiguous" | "none";
  evidenceReference: string | null;
  effectiveDate: string | null;
  deterministic: boolean;
  reason: "RESOLVED" | "AMBIGUOUS_COMPANY_OWNERSHIP" | "NO_OWNERSHIP_EVIDENCE";
};

/**
 * Resolve validated ownership evidence without guessing.
 *
 * Conflicting company IDs are ambiguous even when one candidate came from a
 * higher-priority relation. A caller may only post when deterministic=true.
 */
export function resolvePaymentCompanyEvidence(
  candidates: PaymentCompanyEvidence[],
): PaymentCompanyResolution {
  const validCandidates = candidates.filter((candidate) =>
    Number.isSafeInteger(candidate.companyId) &&
    candidate.companyId > 0 &&
    candidate.evidenceReference.trim().length > 0,
  );
  const companyIds = [...new Set(validCandidates.map((candidate) => candidate.companyId))];
  if (companyIds.length === 0) {
    return {
      companyId: null,
      evidenceSource: "none",
      evidenceReference: null,
      effectiveDate: null,
      deterministic: false,
      reason: "NO_OWNERSHIP_EVIDENCE",
    };
  }
  if (companyIds.length > 1) {
    return {
      companyId: null,
      evidenceSource: "ambiguous",
      evidenceReference: validCandidates
        .map((candidate) => `${candidate.evidenceSource}:${candidate.evidenceReference}=${candidate.companyId}`)
        .join(","),
      effectiveDate: null,
      deterministic: false,
      reason: "AMBIGUOUS_COMPANY_OWNERSHIP",
    };
  }
  const first = validCandidates[0]!;
  const effectiveDates = [...new Set(validCandidates.map((candidate) => candidate.effectiveDate ?? null))];
  return {
    companyId: companyIds[0]!,
    evidenceSource: first.evidenceSource,
    evidenceReference: validCandidates
      .map((candidate) => `${candidate.evidenceSource}:${candidate.evidenceReference}`)
      .join(","),
    effectiveDate: effectiveDates.length === 1 ? effectiveDates[0]! : null,
    deterministic: true,
    reason: "RESOLVED",
  };
}

export type EffectiveFacilityCompanyMapping = {
  id: number;
  facilityId: number;
  companyId: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  isActive: boolean;
};

/**
 * Resolve the effective facility mapping without choosing arbitrarily when
 * data contains overlapping rows. The database exclusion constraint prevents
 * this in normal operation; this guard keeps dry-runs safe on legacy data.
 */
export function resolveEffectiveFacilityCompanyMapping(
  mappings: EffectiveFacilityCompanyMapping[],
  effectiveDate: string,
): EffectiveFacilityCompanyMapping | null {
  const effective = mappings.filter((mapping) =>
    mapping.isActive &&
    mapping.effectiveFrom <= effectiveDate &&
    (!mapping.effectiveUntil || mapping.effectiveUntil >= effectiveDate),
  );
  return effective.length === 1 ? effective[0]! : null;
}