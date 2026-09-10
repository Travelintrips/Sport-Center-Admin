import pg from "pg";
import {
  evaluateQrisMutation,
  type QrisEvaluation,
  type QrisMdrRule,
  type QrisMutationInput,
  type QrisPaymentInput,
} from "../../artifacts/api-server/src/lib/qrisCandidateEngine";
import { computeMatchesForMutation } from "../../artifacts/api-server/src/lib/bankMatcher";

const { Client } = pg;
const MARKER = "UAT_QRIS_202608";
const BATCH_ID = `${MARKER}_BANK_STATEMENT_IMPORT_001`;
const EXPECTED_COUNTS = { payments: 22, mutations: 14, importRows: 14 };

type Row = Record<string, any>;
type ScenarioExpectation = {
  scenario: string;
  expected: "MATCHED" | "REVIEW";
  reference: string;
};

const SCENARIOS: ScenarioExpectation[] = [
  { scenario: "Mandiri normal", expected: "MATCHED", reference: "MANDIRI_NORMAL_SETTLEMENT" },
  { scenario: "Paylabs normal", expected: "MATCHED", reference: "PAYLABS_NORMAL_SETTLEMENT" },
  { scenario: "Friday/weekend", expected: "MATCHED", reference: "WEEKEND_SETTLEMENT_1" },
  { scenario: "Saturday", expected: "MATCHED", reference: "WEEKEND_SETTLEMENT_2" },
  { scenario: "Sunday", expected: "MATCHED", reference: "WEEKEND_SETTLEMENT_3" },
  { scenario: "Holiday", expected: "MATCHED", reference: "HOLIDAY_SETTLEMENT" },
  { scenario: "Unknown provider", expected: "REVIEW", reference: "UNKNOWN_PROVIDER_SETTLEMENT" },
  { scenario: "Amount mismatch", expected: "REVIEW", reference: "AMOUNT_ANOMALY_SETTLEMENT" },
  { scenario: "Different account", expected: "MATCHED", reference: "DIFFERENT_ACCOUNT_SETTLEMENT" },
  { scenario: "Deterministic A", expected: "MATCHED", reference: "DETERMINISTIC_SETTLEMENT_A" },
  { scenario: "Deterministic B", expected: "MATCHED", reference: "DETERMINISTIC_SETTLEMENT_B" },
  { scenario: "Ambiguous A", expected: "REVIEW", reference: "AMBIGUOUS_SETTLEMENT_A" },
  { scenario: "Ambiguous B", expected: "REVIEW", reference: "AMBIGUOUS_SETTLEMENT_B" },
  { scenario: "Rounding", expected: "MATCHED", reference: "ROUNDING_SETTLEMENT" },
];

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") throw new Error("UAT harness refuses NODE_ENV=production.");
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") throw new Error("UAT harness refuses ALLOW_DEV_ON_PROD_DB=true.");
  if (!process.env.SUPABASE_DATABASE_URL_DEV) throw new Error("SUPABASE_DATABASE_URL_DEV is required.");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function numberValue(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric fixture value: ${String(value)}`);
  return result;
}

function dateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  throw new Error(`Invalid date fixture value: ${String(value)}`);
}

function expectationFor(reference: string | null): ScenarioExpectation | undefined {
  return SCENARIOS.find((item) => item.reference === reference);
}

function compactEvaluation(evaluation: QrisEvaluation) {
  return {
    decision: evaluation.decision,
    reason: evaluation.reason,
    provider: evaluation.provider,
    paymentIds: evaluation.paymentIds,
    gross: evaluation.gross,
    credit: evaluation.bankCredit,
    deduction: evaluation.observedDeduction,
    effectiveRate: evaluation.effectiveRate,
    expectedMdrRate: evaluation.expectedMdrRate,
    expectedSettlementDate: evaluation.expectedSettlementDate,
  };
}

function matcherReasonValue(reasons: string[], key: string): string | null {
  const prefix = `${key}=`;
  const entry = reasons.find((reason) => reason.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function matcherPaymentIds(reasons: string[]): number[] {
  const raw = matcherReasonValue(reasons, "payment_ids");
  return raw && raw !== "none"
    ? raw.split(",").filter(Boolean).map(Number)
    : [];
}

function matcherNumberValue(reasons: string[], key: string): number | null {
  const raw = matcherReasonValue(reasons, key);
  if (!raw || raw === "n/a") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function relationCount(client: pg.Client, relation: string, where?: string, params: unknown[] = []) {
  const exists = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [relation]);
  if (!exists.rows[0]?.exists) return { exists: false, count: 0 };
  const result = await client.query(
    `SELECT count(*)::int AS count FROM ${relation}${where ? ` WHERE ${where}` : ""}`,
    params,
  );
  return { exists: true, count: Number(result.rows[0].count) };
}

async function persistenceSnapshot(client: pg.Client, mutationIds: number[]) {
  const mutationFilter = mutationIds.length ? "mutation_id = ANY($1::int[])" : "false";
  return {
    candidatePersistedRows: await relationCount(
      client,
      "sport_center.bank_reconciliation_matches",
      mutationFilter,
      [mutationIds],
    ),
    qrisSettlements: await relationCount(client, "sport_center.qris_settlements"),
    qrisSettlementItems: await relationCount(client, "sport_center.qris_settlement_items"),
    reconciliationMatches: await relationCount(
      client,
      "sport_center.bank_reconciliation_matches",
      mutationFilter,
      [mutationIds],
    ),
    accountingEntries: await relationCount(client, "public.accounting_entries"),
  };
}

function runBoundaryAssertions() {
  const rules: QrisMdrRule[] = [{
    companyId: 62,
    bankAccountId: "MANDIRI",
    provider: "mandiri_direct",
    expectedMdrRate: 0.003,
    rateTolerance: 0.0001,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2026-08-31",
  }];
  const payment = (overrides: Partial<QrisPaymentInput> = {}): QrisPaymentInput => ({
    id: 1,
    companyId: 62,
    bankAccountId: "MANDIRI",
    amount: 100_000,
    provider: "mandiri_direct",
    expectedSettlementDate: "2026-08-04",
    ...overrides,
  });
  const mutation = (overrides: Partial<QrisMutationInput> = {}): QrisMutationInput => ({
    id: 1,
    companyId: 62,
    bankAccountId: "MANDIRI",
    transactionDate: "2026-08-04",
    creditAmount: 99_700,
    provider: "mandiri_direct",
    providerDetectionSource: "UAT boundary assertion",
    description: "UAT | REF MD-001",
    rawPayload: { payment_ids: [1] },
    ...overrides,
  });
  const checks = {
    providerBoundary: evaluateQrisMutation(mutation(), [payment({ provider: "paylabs" })], rules).reason === "QRIS_HARD_BOUNDARY_MISMATCH",
    bankAccountBoundary: evaluateQrisMutation(mutation(), [payment({ bankAccountId: "OTHER" })], rules).reason === "QRIS_HARD_BOUNDARY_MISMATCH",
    settlementDateBoundary: evaluateQrisMutation(mutation(), [payment({ expectedSettlementDate: "2026-08-05" })], rules).reason === "SETTLEMENT_DATE_MISMATCH",
    unknownProviderReview: evaluateQrisMutation(mutation({ provider: "unknown" }), [payment()], rules).decision === "REVIEW",
    negativeDeductionReview: evaluateQrisMutation(mutation({ creditAmount: 100_001 }), [payment()], rules).reason === "NEGATIVE_OBSERVED_DEDUCTION",
    mdrMismatchReview: evaluateQrisMutation(mutation({ creditAmount: 99_500 }), [payment()], rules).reason === "OBSERVED_MDR_OUTSIDE_TOLERANCE",
    deterministicPartition: evaluateQrisMutation(mutation(), [payment()], rules).paymentIds.join(",") === "1",
    ambiguousPartition: evaluateQrisMutation(mutation({ rawPayload: {} }), [payment(), payment({ id: 2 })], rules).reason === "AMBIGUOUS_PAYMENT_PARTITION",
    holidayWeekendInput: evaluateQrisMutation(mutation({ transactionDate: "2026-08-11" }), [payment({ expectedSettlementDate: "2026-08-11" })], rules).decision === "MATCHED",
    roundingTolerance: evaluateQrisMutation(mutation({ creditAmount: 99_700 }), [payment({ amount: 100_000 })], rules).decision === "MATCHED",
  };
  assert(Object.values(checks).every(Boolean), `Boundary assertions failed: ${JSON.stringify(checks)}`);
  return checks;
}

async function main() {
  assertDevelopmentOnly();
  const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV!;
  const connectionString = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const markerCounts = await client.query(
      `SELECT
         (SELECT count(*) FROM sport_center.sport_payments WHERE uat_marker = $1) AS payments,
         (SELECT count(*) FROM sport_center.bank_mutations WHERE uat_marker = $1) AS mutations,
         (SELECT count(*) FROM sport_center.uat_qris_import_rows WHERE batch_id = $2) AS import_rows`,
      [MARKER, BATCH_ID],
    );
    const counts = markerCounts.rows[0];
    assert(
      Number(counts.payments) === EXPECTED_COUNTS.payments &&
      Number(counts.mutations) === EXPECTED_COUNTS.mutations &&
      Number(counts.import_rows) === EXPECTED_COUNTS.importRows,
      `Strict pre-flight failed: ${JSON.stringify(counts)}`,
    );

    const paymentRows = await client.query(
      `SELECT id, company_id AS "companyId", bank_account_id AS "bankAccountId",
              amount, payment_provider AS provider, expected_settlement_date AS "expectedSettlementDate",
              provider_reference AS "providerReference", merchant_trade_no AS "merchantTradeNo",
              provider_trade_no AS "providerTradeNo", notes
         FROM sport_center.sport_payments
        WHERE uat_marker = $1
        ORDER BY id`,
      [MARKER],
    );
    const mutationRows = await client.query(
      `SELECT id, company_id AS "companyId", bank_account_id AS "bankAccountId",
              transaction_date AS "transactionDate", amount, credit_amount AS "creditAmount",
              provider_name AS provider, description, provider_order_id AS "providerOrderId",
              raw_payload AS "rawPayload", source_app AS "sourceApp",
              source_module AS "sourceModule", source_table AS "sourceTable",
              import_batch_id AS "importBatchId", source_classification AS "sourceClassification"
         FROM sport_center.bank_mutations
        WHERE uat_marker = $1
        ORDER BY id`,
      [MARKER],
    );
    const ruleRows = await client.query(
      `SELECT company_id AS "companyId", bank_account_id AS "bankAccountId",
              provider_code AS provider, expected_mdr_rate AS "expectedMdrRate",
              rate_tolerance AS "rateTolerance", effective_from AS "effectiveFrom",
              effective_until AS "effectiveUntil"
         FROM sport_center.uat_qris_mdr_configs
        WHERE marker = $1`,
      [MARKER],
    );

    const payments = paymentRows.rows.map((row): QrisPaymentInput => ({
      id: Number(row.id),
      companyId: row.companyId == null ? null : Number(row.companyId),
      bankAccountId: row.bankAccountId,
      amount: numberValue(row.amount),
      provider: row.provider,
      expectedSettlementDate: row.expectedSettlementDate == null ? null : dateValue(row.expectedSettlementDate),
      providerReference: row.providerReference,
      merchantTradeNo: row.merchantTradeNo,
      providerTradeNo: row.providerTradeNo,
      notes: row.notes,
    }));
    const rules = ruleRows.rows.map((row): QrisMdrRule => ({
      companyId: Number(row.companyId),
      bankAccountId: String(row.bankAccountId),
      provider: row.provider,
      expectedMdrRate: numberValue(row.expectedMdrRate),
      rateTolerance: numberValue(row.rateTolerance),
      effectiveFrom: dateValue(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil == null ? null : dateValue(row.effectiveUntil),
    }));

    const results = mutationRows.rows.map((row) => {
      const mutation: QrisMutationInput = {
        id: Number(row.id),
        companyId: row.companyId == null ? null : Number(row.companyId),
        bankAccountId: row.bankAccountId,
        transactionDate: dateValue(row.transactionDate),
        creditAmount: numberValue(row.creditAmount),
        provider: row.provider,
        providerDetectionSource: row.rawPayload?.provider
          ? "canonical provider field + sanitized raw payload"
          : "canonical mutation provider field",
        description: row.description,
        providerOrderId: row.providerOrderId,
        rawPayload: row.rawPayload,
      };
      const expectation = expectationFor(row.rawPayload?.reference ?? null);
      return {
        mutationId: mutation.id,
        scenario: expectation?.scenario ?? "Unknown",
        expected: expectation?.expected ?? null,
        mutation,
        evaluation: evaluateQrisMutation(mutation, payments, rules),
        provenance: row.sourceApp === "Sport Center" &&
          row.sourceModule === "UAT bank statement import" &&
          row.sourceTable === "UAT CSV statement fixture" &&
          row.importBatchId === BATCH_ID &&
          row.sourceClassification === "actual_bank_mutation",
      };
    });

    assert(results.every((item) => item.expected !== null), "Scenario mapping failed for one or more mutations.");
    assert(results.every((item) => item.provenance), "Provenance validation failed.");
    const scenarioFailures = results.filter((item) => item.evaluation.decision !== item.expected);
    assert(
      scenarioFailures.length === 0,
      `Scenario expectations failed: ${JSON.stringify(scenarioFailures.map((item) => ({
        mutationId: item.mutationId,
        scenario: item.scenario,
        expected: item.expected,
        actual: item.evaluation.decision,
        reason: item.evaluation.reason,
      })))}`,
    );

    const secondRun = results.map((item) => evaluateQrisMutation(item.mutation, payments, rules));
    assert(
      JSON.stringify(results.map((item) => item.evaluation)) === JSON.stringify(secondRun),
      "Idempotency failed.",
    );

    const mutationIds = results.map((item) => item.mutationId);
    const beforePersistence = await persistenceSnapshot(client, mutationIds);
    const parity = [];
    for (const item of results) {
      const row = mutationRows.rows.find((candidate) => Number(candidate.id) === item.mutationId)!;
      const candidates = await computeMatchesForMutation({
        id: Number(row.id),
        companyId: row.companyId == null ? null : Number(row.companyId),
        bankAccountId: row.bankAccountId,
        transactionDate: dateValue(row.transactionDate),
        description: row.description,
        creditAmount: numberValue(row.creditAmount),
        debitAmount: 0,
        amount: numberValue(row.amount ?? row.creditAmount),
        direction: "IN",
        mutationKey: `UAT_READ_ONLY_${row.id}`,
        normalizedDescription: null,
        providerName: row.provider,
        providerOrderId: row.providerOrderId,
        rawPayload: row.rawPayload,
        status: "unmatched",
        accountingPosted: false,
      } as any);
      const candidate = candidates[0] as any;
      const existingDecision = candidate?.hardReview ? "REVIEW" : candidate ? "MATCHED" : "UNMATCHED";
      const existingReason = candidate?.reason?.[0] ?? "NO_CANDIDATE";
      const existingReasons: string[] = candidate?.reason ?? [];
      const existingEvaluation = {
        decision: existingDecision,
        reason: existingReason,
        provider: matcherReasonValue(existingReasons, "provider"),
        paymentIds: matcherPaymentIds(existingReasons),
        gross: matcherNumberValue(existingReasons, "gross") ?? 0,
        credit: matcherNumberValue(existingReasons, "credit") ?? 0,
        deduction: matcherNumberValue(existingReasons, "deduction") ?? 0,
        effectiveRate: matcherNumberValue(existingReasons, "effective_rate"),
        expectedMdrRate: matcherNumberValue(existingReasons, "expected_mdr"),
        expectedSettlementDate: item.evaluation.expectedSettlementDate,
      };
      parity.push({
        mutationId: item.mutationId,
        scenario: item.scenario,
        pure: compactEvaluation(item.evaluation),
        existingMatcher: existingEvaluation,
        same: JSON.stringify(existingEvaluation) === JSON.stringify(compactEvaluation(item.evaluation)),
      });
    }
    const afterPersistence = await persistenceSnapshot(client, mutationIds);
    const boundaryAssertions = runBoundaryAssertions();
    assert(parity.every((item) => item.same), `Matcher parity failed: ${JSON.stringify(parity.filter((item) => !item.same))}`);
    assert(
      JSON.stringify(beforePersistence) === JSON.stringify(afterPersistence),
      `No-persistence assertion failed: before=${JSON.stringify(beforePersistence)} after=${JSON.stringify(afterPersistence)}`,
    );

    console.log(JSON.stringify({
      mode: "read-only/in-memory",
      marker: MARKER,
      counts: { payments: payments.length, mutations: results.length, importRows: EXPECTED_COUNTS.importRows },
      results: results.map(({ mutationId, scenario, mutation, evaluation }) => ({
        mutationId,
        scenario,
        provider: mutation.provider,
        bankAccount: mutation.bankAccountId,
        expectedSettlementDate: evaluation.expectedSettlementDate,
        actualMutationDate: mutation.transactionDate,
        expectedUatMdr: evaluation.expectedMdrRate,
        status: evaluation.decision,
        reason: evaluation.reason,
        paymentIds: evaluation.paymentIds,
        gross: evaluation.gross,
        credit: evaluation.bankCredit,
        deduction: evaluation.observedDeduction,
        effectiveRate: evaluation.effectiveRate,
      })),
      scenarioPassRate: `${results.length}/${results.length}`,
      parity: { pass: true, count: `${parity.length}/${parity.length}`, results: parity },
      boundaryAssertions: { pass: true, checks: boundaryAssertions },
      idempotency: "PASS",
      provenance: "PASS",
      persistence: { before: beforePersistence, after: afterPersistence, unchanged: true },
      finalReconciliation: "NONE",
      accountingPosting: "NONE",
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[uat-qris-harness] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});