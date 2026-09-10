import pg from "pg";
import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");

if (!APPLY || !PROD) {
  console.error(
    "Refusing to run. Use --prod --apply to backfill legacy journal payment metadata.",
  );
  process.exit(1);
}

process.env.NODE_ENV = "production";

const secretResult = await loadSecretsFromGSM();
if (secretResult.fatal.length > 0) {
  console.error("[legacy-journal-metadata] Production secret bootstrap failed.");
  process.exit(1);
}

const connectionString = process.env.SUPABASE_DATABASE_URL;
if (!connectionString) {
  console.error("[legacy-journal-metadata] Production database URL is unavailable.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const candidatesSql = `
  WITH candidates AS (
    SELECT
      aj.id AS journal_id,
      sp.id AS payment_id,
      ROW_NUMBER() OVER (
        PARTITION BY aj.id
        ORDER BY
          CASE WHEN sp.amount = aj.debit_amount THEN 0 ELSE 1 END,
          CASE
            WHEN COALESCE(sp.paid_at, sp.confirmed_at, sp.created_at)::date::text =
                 aj.journal_date THEN 0
            ELSE 1
          END,
          sp.id
      ) AS rank
    FROM sport_center.accounting_journals aj
    JOIN sport_center.sport_payments sp
      ON sp.booking_id = aj.booking_id
     AND sp.status = 'confirmed'
   WHERE aj.journal_type = 'payment_confirmed'
     AND aj.payment_id IS NULL
  )
  SELECT journal_id, payment_id
    FROM candidates
   WHERE rank = 1
   ORDER BY journal_id
`;

try {
  await client.connect();
  const candidates = await client.query(candidatesSql);
  if (candidates.rows.length === 0) {
    console.log("[legacy-journal-metadata] No legacy rows require metadata.");
    process.exit(0);
  }

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(918274615)");
    await client.query(
      "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
    );
    const result = await client.query(`
      WITH candidates AS (
        SELECT
          aj.id AS journal_id,
          sp.*,
          ROW_NUMBER() OVER (
            PARTITION BY aj.id
            ORDER BY
              CASE WHEN sp.amount = aj.debit_amount THEN 0 ELSE 1 END,
              CASE
                WHEN COALESCE(sp.paid_at, sp.confirmed_at, sp.created_at)::date::text =
                     aj.journal_date THEN 0
                ELSE 1
              END,
              sp.id
          ) AS rank
        FROM sport_center.accounting_journals aj
        JOIN sport_center.sport_payments sp
          ON sp.booking_id = aj.booking_id
         AND sp.status = 'confirmed'
       WHERE aj.journal_type = 'payment_confirmed'
         AND aj.payment_id IS NULL
      )
      UPDATE sport_center.accounting_journals aj
         SET payment_method = c.payment_method,
             payment_provider = c.payment_provider::text,
             provider_name = c.provider_name,
             provider_id = c.provider_id,
             payment_type = c.payment_type,
             company_id = c.company_id,
             bank_account_id = c.bank_account_id,
             expected_settlement_date = c.expected_settlement_date,
             settlement_status = c.settlement_status,
             mdr_rate = c.mdr_rate,
             mdr_amount = c.mdr_amount,
             provider_reference = c.provider_reference,
             provider_order_id = c.provider_order_id,
             merchant_trade_no = c.merchant_trade_no,
             provider_trade_no = c.provider_trade_no
        FROM candidates c
       WHERE c.rank = 1
         AND aj.id = c.journal_id
         AND aj.payment_id IS NULL
      RETURNING aj.id
    `);
    await client.query("COMMIT");
    console.log(
      JSON.stringify(
        {
          candidateRows: candidates.rows.length,
          updatedRows: result.rowCount ?? 0,
          paymentIdPreservedNull: true,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
} finally {
  await client.end();
}