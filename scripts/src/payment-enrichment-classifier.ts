import type { PaymentProvider } from "../../artifacts/api-server/src/lib/paymentProvider";

export type HistoricalPaymentEvidence = {
  id: number;
  paymentMethod: string | null;
  paymentProvider: PaymentProvider | null;
  providerReference: string | null;
  merchantTradeNo: string | null;
  providerTradeNo: string | null;
  paidAt: string | Date | null;
  companyId: number | null;
  bankAccountId: string | null;
  expectedSettlementDate: string | null;
  paylabsMatchCount: number;
  sourceMappingMatch: boolean;
  /** A validated booking/facility relation, not merely a matching name. */
  deterministicCompanyEvidence?: boolean;
  /** Exactly one validated company/account settlement rule is effective. */
  deterministicSettlementEvidence?: boolean;
  /** A valid company/provider rule and business-calendar result are available. */
  deterministicExpectedDateEvidence?: boolean;
  /** More than one possible value was found for a dimension. */
  ambiguousDimension?: "company" | "bank_account" | "provider";
};

export type HistoricalPaymentClassification =
  | "SAFE_COMPANY_BACKFILL"
  | "SAFE_BANK_ACCOUNT_BACKFILL"
  | "SAFE_PROVIDER_BACKFILL"
  | "SAFE_EXPECTED_DATE_BACKFILL"
  | "AMBIGUOUS"
  | "NO_EVIDENCE";

export function classifyHistoricalPayment(row: HistoricalPaymentEvidence): {
  classifications: HistoricalPaymentClassification[];
  evidence: string[];
} {
  const classifications: HistoricalPaymentClassification[] = [];
  const evidence: string[] = [];
  const isQris = row.paymentMethod?.trim().toUpperCase() === "QRIS";

  if (row.ambiguousDimension) {
    return {
      classifications: ["AMBIGUOUS"],
      evidence: [`multiple possible ${row.ambiguousDimension} values`],
    };
  }
  if (row.companyId == null && (row.deterministicCompanyEvidence || row.sourceMappingMatch)) {
    classifications.push("SAFE_COMPANY_BACKFILL");
    evidence.push(row.deterministicCompanyEvidence ? "deterministic booking/facility company relation" : "validated import source mapping");
  }
  if (row.bankAccountId == null && (row.deterministicSettlementEvidence || row.sourceMappingMatch)) {
    classifications.push("SAFE_BANK_ACCOUNT_BACKFILL");
    evidence.push(row.deterministicSettlementEvidence ? "one effective company/provider settlement rule" : "validated import source mapping");
  }
  if (row.paymentProvider == null && row.paylabsMatchCount === 1) {
    classifications.push("SAFE_PROVIDER_BACKFILL");
    evidence.push("exactly one Paylabs transaction relation");
  } else if (row.paymentProvider == null && isQris && !row.providerReference && !row.merchantTradeNo) {
    classifications.push("NO_EVIDENCE");
    evidence.push("QRIS has no deterministic provider evidence");
  }
  if (
    row.expectedSettlementDate == null &&
    row.companyId != null &&
    row.bankAccountId != null &&
    row.paymentProvider != null &&
    row.paidAt != null &&
    row.deterministicExpectedDateEvidence === true
  ) {
    classifications.push("SAFE_EXPECTED_DATE_BACKFILL");
    evidence.push("canonical dimensions are complete; date rule can be evaluated");
  }
  if (row.paylabsMatchCount > 1) {
    return {
      classifications: ["AMBIGUOUS"],
      evidence: ["multiple Paylabs transaction relations"],
    };
  }
  if (!classifications.length) {
    classifications.push(isQris ? "NO_EVIDENCE" : "AMBIGUOUS");
    evidence.push(isQris ? "no deterministic enrichment evidence" : "non-QRIS historical row is outside classifier scope");
  }
  return { classifications: [...new Set(classifications)], evidence: [...new Set(evidence)] };
}