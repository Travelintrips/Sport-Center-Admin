import assert from "node:assert/strict";
import {
  classifyHistoricalPayment,
  type HistoricalPaymentEvidence,
} from "./payment-enrichment-classifier.js";

function base(overrides: Partial<HistoricalPaymentEvidence> = {}): HistoricalPaymentEvidence {
  return {
    id: 100,
    paymentMethod: "QRIS",
    paymentProvider: null,
    providerReference: null,
    merchantTradeNo: null,
    providerTradeNo: null,
    paidAt: null,
    companyId: null,
    bankAccountId: null,
    expectedSettlementDate: null,
    paylabsMatchCount: 0,
    sourceMappingMatch: false,
    ...overrides,
  };
}

function classifications(row: HistoricalPaymentEvidence) {
  return classifyHistoricalPayment(row).classifications;
}

function hasClassification(row: HistoricalPaymentEvidence, value: string) {
  return classifications(row).includes(value as HistoricalPaymentEvidence extends never ? never : any);
}

const safeCompany = base({ deterministicCompanyEvidence: true });
assert.equal(hasClassification(safeCompany, "SAFE_COMPANY_BACKFILL"), true);

assert.equal(hasClassification(base({ deterministicSettlementEvidence: true }), "SAFE_BANK_ACCOUNT_BACKFILL"), true);

assert.deepEqual(
  classifications(base({ paylabsMatchCount: 1 })),
  ["SAFE_PROVIDER_BACKFILL"],
);

assert.deepEqual(
  classifications(base({
    companyId: 62,
    bankAccountId: "MANDIRI-CST",
    paymentProvider: "paylabs",
    paidAt: "2026-08-08T02:00:00.000Z",
    deterministicExpectedDateEvidence: true,
  })),
  ["SAFE_EXPECTED_DATE_BACKFILL"],
);

assert.deepEqual(
  classifications(base({ ambiguousDimension: "company", paylabsMatchCount: 2 })),
  ["AMBIGUOUS"],
);

assert.deepEqual(classifications(base()), ["NO_EVIDENCE"]);

// The classifier is a recommendation-only pure function. A frozen historical
// row remains unchanged and no database client or mutation API is involved.
const historical = Object.freeze(base({ id: 101 }));
const before = JSON.stringify(historical);
const recommendation = classifyHistoricalPayment(historical);
assert.equal(JSON.stringify(historical), before);
assert.ok(recommendation.classifications.length > 0);

console.log("payment-enrichment-classifier: 7/7 PASS (dry-run only)");