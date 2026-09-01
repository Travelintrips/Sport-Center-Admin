export type QrisProvider = "mandiri_direct" | "paylabs" | "unknown";

export type QrisPaymentInput = {
  id: number;
  companyId: number | null;
  bankAccountId: string | null;
  amount: number;
  provider: QrisProvider | null;
  paymentMethod?: string | null;
  providerName?: string | null;
  expectedSettlementDate: string | null;
  providerReference?: string | null;
  merchantTradeNo?: string | null;
  providerTradeNo?: string | null;
  notes?: string | null;
};

export type QrisMutationInput = {
  id: number;
  companyId: number | null;
  bankAccountId: string | null;
  transactionDate: string;
  creditAmount: number;
  amount?: number;
  provider: QrisProvider | null;
  providerDetectionSource: string;
  description: string;
  providerOrderId?: string | null;
  rawPayload?: Record<string, unknown> | null;
};

export type QrisMdrRule = {
  companyId: number;
  bankAccountId: string;
  provider: Exclude<QrisProvider, "unknown">;
  expectedMdrRate: number;
  rateTolerance: number;
  effectiveFrom: string;
  effectiveUntil?: string | null;
};

export type QrisDecision = "MATCHED" | "REVIEW" | "UNMATCHED";

export type QrisEvaluation = {
  decision: QrisDecision;
  reason: string;
  provider: QrisProvider | null;
  providerDetectionSource: string;
  paymentIds: number[];
  gross: number;
  bankCredit: number;
  observedDeduction: number;
  effectiveRate: number | null;
  expectedMdrRate: number | null;
  variance: number | null;
  expectedSettlementDate: string | null;
  confidence: "HIGH" | "LOW" | "NONE";
  referenceEvidence: string | null;
};

const PROVIDERS = new Set<QrisProvider>(["mandiri_direct", "paylabs", "unknown"]);

function asProvider(value: unknown): QrisProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return PROVIDERS.has(normalized as QrisProvider) ? normalized as QrisProvider : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseReference(description: string): string | null {
  const match = description.match(/\bREF\s+([A-Z0-9-]+)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function hasReferenceEvidence(
  mutation: QrisMutationInput,
  payment: QrisPaymentInput,
  reference: string | null,
): boolean {
  if (!reference) return false;
  const haystack = [
    payment.providerReference,
    payment.merchantTradeNo,
    payment.providerTradeNo,
    payment.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return haystack.includes(reference);
}

function selectReferencedPayments(
  mutation: QrisMutationInput,
  payments: QrisPaymentInput[],
  reference: string | null,
): QrisPaymentInput[] {
  // Importers may carry an immutable payment-id partition in sanitized metadata.
  // It is accepted only when the statement also has a discriminating reference.
  if (reference) {
    const rawPaymentIds = mutation.rawPayload?.payment_ids;
    if (Array.isArray(rawPaymentIds)) {
      const ids = new Set(rawPaymentIds.filter((id): id is number => Number.isInteger(id)));
      const byId = payments.filter((payment) => ids.has(payment.id));
      if (byId.length) return byId;
    }

    const byReference = payments.filter((payment) =>
      hasReferenceEvidence(mutation, payment, reference),
    );
    if (byReference.length) return byReference;
  }

  return [];
}

function ruleFor(
  mutation: QrisMutationInput,
  provider: QrisProvider,
  rules: QrisMdrRule[],
): QrisMdrRule | null {
  if (provider === "unknown" || !mutation.bankAccountId || mutation.companyId == null) return null;
  return rules.find((rule) =>
    rule.companyId === mutation.companyId &&
    rule.bankAccountId === mutation.bankAccountId &&
    rule.provider === provider &&
    rule.effectiveFrom <= mutation.transactionDate &&
    (!rule.effectiveUntil || mutation.transactionDate <= rule.effectiveUntil),
  ) ?? null;
}

function baseEvaluation(
  mutation: QrisMutationInput,
  provider: QrisProvider | null,
  reason: string,
  decision: QrisDecision,
  paymentIds: number[] = [],
  gross = 0,
  expectedSettlementDate: string | null = null,
  referenceEvidence: string | null = null,
): QrisEvaluation {
  const bankCredit = roundMoney(mutation.creditAmount);
  const observedDeduction = roundMoney(gross - bankCredit);
  return {
    decision,
    reason,
    provider,
    providerDetectionSource: mutation.providerDetectionSource,
    paymentIds,
    gross: roundMoney(gross),
    bankCredit,
    observedDeduction,
    effectiveRate: gross > 0 ? observedDeduction / gross : null,
    expectedMdrRate: null,
    variance: null,
    expectedSettlementDate,
    confidence: decision === "MATCHED" ? "HIGH" : decision === "REVIEW" ? "LOW" : "NONE",
    referenceEvidence,
  };
}

/**
 * Pure QRIS decision engine. It never reads or writes a database.
 *
 * The caller must scope `payments` and `rules` to the reconciliation run.
 * Provider, company, account, and expected settlement date are hard boundaries;
 * amount and MDR are validation layers after those boundaries pass.
 */
export function evaluateQrisMutation(
  mutation: QrisMutationInput,
  payments: QrisPaymentInput[],
  rules: QrisMdrRule[],
): QrisEvaluation {
  const provider = mutation.provider ?? asProvider(mutation.rawPayload?.provider);
  const referenceEvidence = parseReference(mutation.description);

  if (provider === "unknown" || !provider) {
    const rawPaymentIds = mutation.rawPayload?.payment_ids;
    const paymentIds = Array.isArray(rawPaymentIds)
      ? rawPaymentIds.filter((id): id is number => Number.isInteger(id))
      : [];
    const referencedPayments = payments.filter((payment) => paymentIds.includes(payment.id));
    const gross = referencedPayments.reduce((sum, payment) => sum + payment.amount, 0);
    return baseEvaluation(
      mutation,
      provider,
      "PROVIDER_UNKNOWN",
      "REVIEW",
      paymentIds,
      gross,
      null,
      referenceEvidence,
    );
  }

  if (mutation.creditAmount <= 0) {
    return baseEvaluation(mutation, provider, "NON_CREDIT_MUTATION", "UNMATCHED", [], 0, null, referenceEvidence);
  }

  const boundaryPayments = payments.filter((payment) =>
    payment.companyId != null &&
    mutation.companyId != null &&
    payment.companyId === mutation.companyId &&
    payment.bankAccountId != null &&
    mutation.bankAccountId != null &&
    payment.bankAccountId === mutation.bankAccountId &&
    payment.provider === provider &&
    payment.paymentMethod?.trim().toUpperCase() === "QRIS" &&
    payment.providerName?.trim() &&
    payment.providerName.trim().toLowerCase() !== "unknown"
  );
  const scopedPayments = boundaryPayments.filter(
    (payment) => payment.expectedSettlementDate === mutation.transactionDate,
  );

  const referencedPayments = selectReferencedPayments(mutation, boundaryPayments, referenceEvidence);
  let selectedPayments = referencedPayments;

  if (!selectedPayments.length) {
    if (boundaryPayments.length === 1 && scopedPayments.length === 0) {
      const payment = boundaryPayments[0];
      return baseEvaluation(
        mutation,
        provider,
        "SETTLEMENT_DATE_MISMATCH",
        "REVIEW",
        [payment.id],
        payment.amount,
        payment.expectedSettlementDate,
        referenceEvidence,
      );
    }
    if (scopedPayments.length === 1) {
      selectedPayments = scopedPayments;
    } else if (scopedPayments.length > 1) {
      return baseEvaluation(
        mutation,
        provider,
        "AMBIGUOUS_PAYMENT_PARTITION",
        "REVIEW",
        [],
        0,
        null,
        referenceEvidence,
      );
    } else {
      return baseEvaluation(mutation, provider, "QRIS_HARD_BOUNDARY_MISMATCH", "UNMATCHED", [], 0, null, referenceEvidence);
    }
  }

  const paymentIds = selectedPayments.map((payment) => payment.id);
  const gross = selectedPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const expectedSettlementDates = new Set(
    selectedPayments.map((payment) => payment.expectedSettlementDate).filter(Boolean),
  );

  if (expectedSettlementDates.size !== 1 || !expectedSettlementDates.has(mutation.transactionDate)) {
    return baseEvaluation(
      mutation,
      provider,
      "SETTLEMENT_DATE_MISMATCH",
      "REVIEW",
      paymentIds,
      gross,
      selectedPayments[0]?.expectedSettlementDate ?? null,
      referenceEvidence,
    );
  }

  const observedDeduction = roundMoney(gross - mutation.creditAmount);
  const effectiveRate = gross > 0 ? observedDeduction / gross : null;
  const rule = ruleFor(mutation, provider, rules);

  const result = baseEvaluation(
    mutation,
    provider,
    "DETERMINISTIC_PROVIDER_ACCOUNT_DATE_REFERENCE_MDR",
    "MATCHED",
    paymentIds,
    gross,
    selectedPayments[0]?.expectedSettlementDate ?? null,
    referenceEvidence,
  );
  result.observedDeduction = observedDeduction;
  result.effectiveRate = effectiveRate;

  if (observedDeduction < 0) {
    result.decision = "REVIEW";
    result.reason = "NEGATIVE_OBSERVED_DEDUCTION";
    result.confidence = "LOW";
    return result;
  }

  if (!rule) {
    result.decision = "REVIEW";
    result.reason = "MDR_CONFIG_MISSING";
    result.confidence = "LOW";
    return result;
  }

  result.expectedMdrRate = rule.expectedMdrRate;
  result.variance = (effectiveRate ?? 0) - rule.expectedMdrRate;
  if (Math.abs(result.variance) > rule.rateTolerance) {
    result.decision = "REVIEW";
    result.reason = "OBSERVED_MDR_OUTSIDE_TOLERANCE";
    result.confidence = "LOW";
    return result;
  }

  return result;
}
