import pg from "pg";
import { createHash } from "node:crypto";
import { classifyHistoricalPayment, type HistoricalPaymentEvidence } from "./payment-enrichment-classifier.js";

const { Client } = pg;
const marker = process.argv.find((arg) => arg.startsWith("--marker="))?.slice(9) ?? null;
const paymentId = Number(process.argv.find((arg) => arg.startsWith("--payment-id="))?.slice(13) ?? 0) || null;
const from = process.argv.find((arg) => arg.startsWith("--from="))?.slice(7) ?? "1900-01-01";
const to = process.argv.find((arg) => arg.startsWith("--to="))?.slice(5) ?? "2999-12-31";
const provider = process.argv.find((arg) => arg.startsWith("--provider="))?.slice(11) ?? null;
const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.DATABASE_URL;

if (!rawUrl) throw new Error("Active environment database is not configured.");

const url = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
const client = new Client({ connectionString: url, ssl: /supabase\./.test(url) ? { rejectUnauthorized: false } : undefined });
const host = (() => { try { return new URL(rawUrl).hostname; } catch { return "unconfigured"; } })();

await client.connect();
try {
  const environment = process.env.NODE_ENV ?? "unknown";
  const fingerprint = createHash("sha256").update(`${host}|${environment}`).digest("hex").slice(0, 12);
  const identity = {
    appEnv: environment,
    databaseHost: host,
    databaseFingerprint: fingerprint,
    schema: "sport_center",
    companyTarget: process.env.UAT_COMPANY_ID ? Number(process.env.UAT_COMPANY_ID) : null,
    uatMarker: marker,
    uatMarkerPresent: marker
      ? (await client.query(
        `SELECT EXISTS (SELECT 1 FROM sport_center.sport_payments WHERE uat_marker = $1)
          OR EXISTS (SELECT 1 FROM sport_center.bank_mutations WHERE uat_marker = $1) AS present`,
        [marker],
      )).rows[0]?.present === true
      : null,
  };

  if (paymentId) {
    const payment = await client.query(
      `SELECT id, payment_method AS "paymentMethod", payment_provider AS "paymentProvider",
              provider_reference AS "providerReference", merchant_trade_no AS "merchantTradeNo",
              provider_trade_no AS "providerTradeNo", company_id AS "companyId",
              bank_account_id AS "bankAccountId", expected_settlement_date AS "expectedSettlementDate"
         FROM sport_center.sport_payments WHERE id = $1 LIMIT 1`,
      [paymentId],
    );
    if (!payment.rowCount) {
      console.log(JSON.stringify({ ...identity, error: "RECORD_NOT_FOUND_IN_ACTIVE_ENVIRONMENT", requestedPaymentId: paymentId }, null, 2));
      process.exitCode = 0;
    } else {
      const row = payment.rows[0] as HistoricalPaymentEvidence;
      const paylabs = await client.query(
        `SELECT count(*)::int AS count FROM sport_center.paylabs_transactions
          WHERE booking_id = (SELECT booking_id FROM sport_center.sport_payments WHERE id = $1)`,
        [paymentId],
      );
      console.log(JSON.stringify({ ...identity, payment: row, classification: classifyHistoricalPayment({ ...row, paylabsMatchCount: Number(paylabs.rows[0]?.count ?? 0), sourceMappingMatch: false }) }, null, 2));
    }
  } else {
    const counts = await client.query(
      `SELECT
        count(*)::int AS payment_count,
        COALESCE(sum(amount), 0)::numeric AS gross,
        count(*) FILTER (WHERE payment_provider = 'mandiri_direct')::int AS mandiri_count,
        COALESCE(sum(amount) FILTER (WHERE payment_provider = 'mandiri_direct'), 0)::numeric AS mandiri_gross,
        count(*) FILTER (WHERE payment_provider = 'paylabs')::int AS paylabs_count,
        COALESCE(sum(amount) FILTER (WHERE payment_provider = 'paylabs'), 0)::numeric AS paylabs_gross,
        count(*) FILTER (WHERE payment_provider = 'unknown' OR payment_provider IS NULL)::int AS unknown_count,
        COALESCE(sum(amount) FILTER (WHERE payment_provider = 'unknown' OR payment_provider IS NULL), 0)::numeric AS unknown_gross
       FROM sport_center.sport_payments
       WHERE COALESCE(paid_at, confirmed_at, created_at)::date BETWEEN $1 AND $2
         AND ($3::text IS NULL OR payment_provider = $3)`,
      [from, to, provider],
    );
    const mirror = await client.query(
      `SELECT count(*)::int AS payment_count, COALESCE(sum(amount), 0)::numeric AS gross,
              count(*) FILTER (WHERE source_payment_id IS NULL)::int AS missing_source_ids
         FROM public.sport_payments
        WHERE COALESCE(paid_at, created_at)::date BETWEEN $1 AND $2
          AND source = 'SPORT_CENTER_SUPABASE'
          AND ($3::text IS NULL OR COALESCE(payment_provider, provider_code) = $3)`,
      [from, to, provider],
    ).catch(() => ({ rows: [{ payment_count: 0, gross: 0, missing_source_ids: 0 }] }));
    console.log(JSON.stringify({
      ...identity,
      range: { from, to, provider },
      mirrorCompleteness: {
        sportCenter: counts.rows[0],
        cst: mirror.rows[0],
      },
      mode: "read-only",
    }, null, 2));
  }
} finally {
  await client.end();
}