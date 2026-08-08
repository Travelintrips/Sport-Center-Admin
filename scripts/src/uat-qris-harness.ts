import pg from "pg";
import {
  evaluateQrisMutation,
  type QrisMdrRule,
  type QrisMutationInput,
  type QrisPaymentInput,
} from "../../artifacts/api-server/src/lib/qrisCandidateEngine";

const { Client } = pg;
const MARKER = "UAT_QRIS_202608";
const BATCH_ID = `${MARKER}_BANK_STATEMENT_IMPORT_001`;

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") throw new Error("UAT harness refuses NODE_ENV=production.");
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") throw new Error("UAT harness refuses ALLOW_DEV_ON_PROD_DB=true.");
  if (!process.env.SUPABASE_DATABASE_URL_DEV) throw new Error("SUPABASE_DATABASE_URL_DEV is required.");
}

function numberValue(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid numeric fixture value: ${String(value)}`);
  return result;
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
    if (Number(counts.payments) !== 22 || Number(counts.mutations) !== 14 || Number(counts.import_rows) !== 14) {
      throw new Error(`Strict pre-flight failed: ${JSON.stringify(counts)}`);
    }

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
              transaction_date AS "transactionDate", credit_amount AS "creditAmount",
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
        WHERE marker = $1 AND active IS NOT FALSE`,
      [MARKER],
    );

    const payments = paymentRows.rows.map((row): QrisPaymentInput => ({
      id: Number(row.id),
      companyId: row.companyId == null ? null : Number(row.companyId),
      bankAccountId: row.bankAccountId,
      amount: numberValue(row.amount),
      provider: row.provider,
      expectedSettlementDate: row.expectedSettlementDate?.slice(0, 10) ?? null,
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
      effectiveFrom: row.effectiveFrom.slice(0, 10),
      effectiveUntil: row.effectiveUntil?.slice(0, 10) ?? null,
    }));
    const results = mutationRows.rows.map((row) => {
      const mutation: QrisMutationInput = {
        id: Number(row.id),
        companyId: row.companyId == null ? null : Number(row.companyId),
        bankAccountId: row.bankAccountId,
        transactionDate: row.transactionDate.slice(0, 10),
        creditAmount: numberValue(row.creditAmount),
        provider: row.provider,
        providerDetectionSource: row.rawPayload?.provider
          ? "canonical provider field + sanitized raw payload"
          : "canonical mutation provider field",
        description: row.description,
        providerOrderId: row.providerOrderId,
        rawPayload: row.rawPayload,
      };
      return {
        mutationId: mutation.id,
        evaluation: evaluateQrisMutation(mutation, payments, rules),
        provenance: row.sourceApp === "Sport Center" &&
          row.sourceModule === "UAT bank statement import" &&
          row.sourceTable === "UAT CSV statement fixture" &&
          row.importBatchId === BATCH_ID &&
          row.sourceClassification === "actual_bank_mutation",
      };
    });
    const secondRun = mutationRows.rows.map((row) => evaluateQrisMutation({
      id: Number(row.id),
      companyId: row.companyId == null ? null : Number(row.companyId),
      bankAccountId: row.bankAccountId,
      transactionDate: row.transactionDate.slice(0, 10),
      creditAmount: numberValue(row.creditAmount),
      provider: row.provider,
      providerDetectionSource: row.rawPayload?.provider
        ? "canonical provider field + sanitized raw payload"
        : "canonical mutation provider field",
      description: row.description,
      providerOrderId: row.providerOrderId,
      rawPayload: row.rawPayload,
    }, payments, rules));
    const firstJson = JSON.stringify(results.map((item) => item.evaluation));
    const secondJson = JSON.stringify(secondRun);
    if (firstJson !== secondJson) throw new Error("Idempotency failed.");
    if (results.some((item) => !item.provenance)) throw new Error("Provenance validation failed.");

    console.log(JSON.stringify({
      mode: "read-only/in-memory",
      marker: MARKER,
      counts: { payments: payments.length, mutations: results.length },
      results: results.map(({ mutationId, evaluation }) => ({
        mutationId,
        decision: evaluation.decision,
        reason: evaluation.reason,
        provider: evaluation.provider,
        paymentIds: evaluation.paymentIds,
        gross: evaluation.gross,
        deduction: evaluation.observedDeduction,
        effectiveRate: evaluation.effectiveRate,
      })),
      idempotency: "PASS",
      provenance: "PASS",
      persistence: "NONE",
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