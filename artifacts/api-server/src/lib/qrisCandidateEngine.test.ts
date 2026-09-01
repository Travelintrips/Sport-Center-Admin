import { describe, expect, it } from "@jest/globals";
import { evaluateQrisMutation, type QrisMdrRule, type QrisMutationInput, type QrisPaymentInput } from "./qrisCandidateEngine";

const rules: QrisMdrRule[] = [
  {
    companyId: 62,
    bankAccountId: "MANDIRI",
    provider: "mandiri_direct",
    expectedMdrRate: 0.003,
    rateTolerance: 0.0001,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2026-08-31",
  },
  {
    companyId: 62,
    bankAccountId: "MANDIRI",
    provider: "paylabs",
    expectedMdrRate: 0.007,
    rateTolerance: 0.0001,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2026-08-31",
  },
];

function payment(overrides: Partial<QrisPaymentInput> = {}): QrisPaymentInput {
  return {
    id: 1,
    companyId: 62,
    bankAccountId: "MANDIRI",
    amount: 100_000,
    provider: "mandiri_direct",
    paymentMethod: "QRIS",
    providerName: "Mandiri Direct",
    expectedSettlementDate: "2026-08-04",
    ...overrides,
  };
}

function mutation(overrides: Partial<QrisMutationInput> = {}): QrisMutationInput {
  return {
    id: 1,
    companyId: 62,
    bankAccountId: "MANDIRI",
    transactionDate: "2026-08-04",
    creditAmount: 99_700,
    provider: "mandiri_direct",
    providerDetectionSource: "test reference",
    description: "UAT | REF MD-001",
    rawPayload: { payment_ids: [1] },
    ...overrides,
  };
}

describe("strict QRIS candidate engine", () => {
  it("enforces provider and bank-account boundaries", () => {
    expect(evaluateQrisMutation(mutation(), [payment({ provider: "paylabs" })], rules).reason)
      .toBe("QRIS_HARD_BOUNDARY_MISMATCH");
    expect(evaluateQrisMutation(mutation(), [payment({ bankAccountId: "OTHER" })], rules).reason)
      .toBe("QRIS_HARD_BOUNDARY_MISMATCH");
    expect(evaluateQrisMutation(mutation(), [payment({ bankAccountId: null })], rules).reason)
      .toBe("QRIS_HARD_BOUNDARY_MISMATCH");
  });

  it("enforces expected settlement date", () => {
    const result = evaluateQrisMutation(
      mutation(),
      [payment({ expectedSettlementDate: "2026-08-05" })],
      rules,
    );
    expect(result.decision).toBe("REVIEW");
    expect(result.reason).toBe("SETTLEMENT_DATE_MISMATCH");
  });

  it("reviews unknown providers and negative deductions", () => {
    expect(evaluateQrisMutation(
      mutation({ provider: "unknown" }),
      [payment()],
      rules,
    ).reason).toBe("PROVIDER_UNKNOWN");
    expect(evaluateQrisMutation(
      mutation({ creditAmount: 100_001 }),
      [payment()],
      rules,
    ).reason).toBe("NEGATIVE_OBSERVED_DEDUCTION");
  });

  it("validates MDR and preserves deterministic partitions", () => {
    const matched = evaluateQrisMutation(mutation(), [payment()], rules);
    expect(matched.decision).toBe("MATCHED");
    expect(matched.paymentIds).toEqual([1]);

    const mismatch = evaluateQrisMutation(
      mutation({ creditAmount: 99_500 }),
      [payment()],
      rules,
    );
    expect(mismatch.decision).toBe("REVIEW");
    expect(mismatch.reason).toBe("OBSERVED_MDR_OUTSIDE_TOLERANCE");

    const ambiguous = evaluateQrisMutation(
      mutation({ rawPayload: {} }),
      [payment({ id: 1 }), payment({ id: 2 })],
      rules,
    );
    expect(ambiguous.decision).toBe("REVIEW");
    expect(ambiguous.reason).toBe("AMBIGUOUS_PAYMENT_PARTITION");
  });

  it("accepts rounding within tolerance", () => {
    const result = evaluateQrisMutation(
      mutation({ creditAmount: 99_700 }),
      [payment({ amount: 100_000 })],
      rules,
    );
    expect(result.decision).toBe("MATCHED");
  });
});
