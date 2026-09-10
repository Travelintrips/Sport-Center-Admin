import pg from "pg";

const { Client } = pg;
const MARKER = "UAT_QRIS_202608";
const BATCH_ID = `${MARKER}_BANK_STATEMENT_IMPORT_001`;

function assertDevelopmentOnly() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing fixture repair while NODE_ENV=production.");
  if (process.env.ALLOW_DEV_ON_PROD_DB === "true") throw new Error("Refusing fixture repair while ALLOW_DEV_ON_PROD_DB=true.");
  if (!process.env.SUPABASE_DATABASE_URL_DEV) throw new Error("SUPABASE_DATABASE_URL_DEV is required.");
}

async function main() {
  assertDevelopmentOnly();
  const rawUrl = process.env.SUPABASE_DATABASE_URL_DEV!;
  const connectionString = rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query("BEGIN");

    // Older fixture runs created unique marker indexes, but the UAT contract
    // uses one queryable marker for the whole scoped dataset.
    await client.query(`
      DROP INDEX IF EXISTS sport_center.sport_bookings_uat_marker_uidx;
      DROP INDEX IF EXISTS sport_center.sport_payments_uat_marker_uidx;
      DROP INDEX IF EXISTS sport_center.bank_mutations_uat_marker_uidx;
      CREATE INDEX IF NOT EXISTS sport_bookings_uat_marker_idx
        ON sport_center.sport_bookings (uat_marker) WHERE uat_marker IS NOT NULL;
      CREATE INDEX IF NOT EXISTS sport_payments_uat_marker_idx
        ON sport_center.sport_payments (uat_marker) WHERE uat_marker IS NOT NULL;
      CREATE INDEX IF NOT EXISTS bank_mutations_uat_marker_idx
        ON sport_center.bank_mutations (uat_marker) WHERE uat_marker IS NOT NULL;
    `);

    const bookings = await client.query(
      `UPDATE sport_center.sport_bookings
          SET uat_marker = $1
        WHERE uat_marker LIKE $2 OR notes ILIKE $3`,
      [MARKER, `${MARKER}%`, `%${MARKER}%`],
    );
    const payments = await client.query(
      `UPDATE sport_center.sport_payments
          SET uat_marker = $1
        WHERE uat_marker LIKE $2
           OR notes ILIKE $3
           OR provider_reference ILIKE $3
           OR merchant_trade_no ILIKE $3`,
      [MARKER, `${MARKER}%`, `%${MARKER}%`],
    );
    const mutations = await client.query(
      `UPDATE sport_center.bank_mutations
          SET uat_marker = $1
        WHERE uat_marker LIKE $2
           OR description ILIKE $3
           OR mutation_key LIKE $2
           OR import_batch_id = $4`,
      [MARKER, `${MARKER}%`, `%${MARKER}%`, BATCH_ID],
    );

    const fridayPayload = JSON.stringify({ tanggal: "2026-08-11" });
    await client.query(
      `UPDATE sport_center.uat_qris_import_rows
          SET transaction_date = '2026-08-11',
              raw_payload = raw_payload || $1::jsonb
        WHERE batch_id = $2
          AND raw_payload->>'reference' = 'WEEKEND_FRIDAY'`,
      [fridayPayload, BATCH_ID],
    );
    await client.query(
      `UPDATE sport_center.bank_mutations
          SET transaction_date = '2026-08-11',
              raw_payload = raw_payload || $1::jsonb
        WHERE uat_marker = $2
          AND mutation_key = $3`,
      [fridayPayload, MARKER, `${MARKER}_WEEKEND_SETTLEMENT_1`],
    );

    const paylabsPayload = JSON.stringify({ credit: 347550 });
    const paylabs = await client.query(
      `UPDATE sport_center.bank_mutations
          SET credit_amount = 347550,
              amount = 347550,
              raw_payload = raw_payload || $1::jsonb
        WHERE uat_marker = $2
          AND mutation_key = $3`,
      [paylabsPayload, MARKER, `${MARKER}_DETERMINISTIC_SETTLEMENT_A`],
    );
    await client.query(
      `UPDATE sport_center.uat_qris_import_rows
          SET credit_amount = 347550,
              raw_payload = raw_payload || $1::jsonb
        WHERE batch_id = $2
          AND raw_payload->>'reference' = 'DETERMINISTIC_SETTLEMENT_A'`,
      [paylabsPayload, BATCH_ID],
    );

    const counts = await client.query(
      `SELECT
        (SELECT count(*) FROM sport_center.sport_payments WHERE uat_marker = $1) AS payments,
        (SELECT count(*) FROM sport_center.bank_mutations WHERE uat_marker = $1) AS mutations,
        (SELECT count(*) FROM sport_center.uat_qris_import_rows WHERE batch_id = $2) AS import_rows`,
      [MARKER, BATCH_ID],
    );
    const result = counts.rows[0];
    if (Number(result.payments) !== 22 || Number(result.mutations) !== 14 || Number(result.import_rows) !== 14) {
      throw new Error(`Fixture count validation failed: ${JSON.stringify(result)}`);
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      status: "UAT_FIXTURE_REPAIRED",
      marker: MARKER,
      updated: {
        bookings: bookings.rowCount,
        payments: payments.rowCount,
        mutations: mutations.rowCount,
        friday: 1,
        paylabsPartitionA: paylabs.rowCount,
      },
      counts: result,
      finalReconciliation: false,
      accountingPosted: false,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[repair:uat-qris] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});