export type PaymentCompanyEvidenceSource =
  | "booking_company_relation"
  | "booking_company_invoice"
  | "validated_explicit_configuration"
  | "facility_ownership";

export type PaymentCompanyEvidence = {
  companyId: number;
  evidenceSource: PaymentCompanyEvidenceSource;
  evidenceReference: string;
};

export type PaymentCompanyResolution = {
  companyId: number | null;
  evidenceSource: PaymentCompanyEvidenceSource | "ambiguous" | "none";
  evidenceReference: string | null;
  deterministic: boolean;
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
      deterministic: false,
    };
  }
  if (companyIds.length > 1) {
    return {
      companyId: null,
      evidenceSource: "ambiguous",
      evidenceReference: validCandidates
        .map((candidate) => `${candidate.evidenceSource}:${candidate.evidenceReference}=${candidate.companyId}`)
        .join(","),
      deterministic: false,
    };
  }
  const first = validCandidates[0]!;
  return {
    companyId: companyIds[0]!,
    evidenceSource: first.evidenceSource,
    evidenceReference: validCandidates
      .map((candidate) => `${candidate.evidenceSource}:${candidate.evidenceReference}`)
      .join(","),
    deterministic: true,
  };
}