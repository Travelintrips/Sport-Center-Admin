import pg from "pg";

if (process.env.NODE_ENV === "production" || process.env.APP_ENV !== "development") {
  throw new Error("CF-SC-8 is development-only; refusing to run outside development.");
}
if (!process.env.SUPABASE_DATABASE_URL_DEV) {
  throw new Error("SUPABASE_DATABASE_URL_DEV is required.");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'sport_center'
         AND p.proname = 'create_payment_settlement_batch'
         AND pg_get_function_identity_arguments(p.oid) =
             'p_settlement_reference text, p_company_id integer, p_provider_code text, p_bank_account_id text, p_settlement_date date, p_payment_ids integer[], p_actor text'
       LIMIT 1
    `);
    const definition = String(result.rows[0]?.definition ?? "");
    if (!definition) throw new Error("CF-SC-8 canonical settlement function not found.");
    const identity = `
      IF p_actor = 'central_finance'
         AND cardinality(p_payment_ids) = 1 THEN
        v_reference := 'CF_SC_8_PAYMENT_SCOPED:' || p_payment_ids[1]::text;
        v_correlation := 'sc_payment_settlement_' || p_payment_ids[1]::text;
      ELSE
        v_reference := v_identity.settlement_reference;
        v_correlation := v_identity.correlation_id;
      END IF;
      -- CF_SC_8_PAYMENT_SCOPED
`;
    const oldIdentity = `
      v_reference := v_identity.settlement_reference;
      v_correlation := v_identity.correlation_id;
`;
    let patched = definition;
    if (!definition.includes("CF_SC_8_PAYMENT_SCOPED")) {
      if (!definition.includes(oldIdentity)) {
        throw new Error("CF-SC-8 could not locate canonical identity assignment.");
      }
      patched = definition.replace(oldIdentity, identity);
    }
    const oldBatchPredicate = `
         AND status IN ('draft', 'calculated', 'posted', 'reconciled')
       FOR UPDATE;
`;
    const newBatchPredicate = `
         AND status IN ('draft', 'calculated', 'posted', 'reconciled')
         AND (
           p_actor <> 'central_finance'
           OR EXISTS (
             SELECT 1
               FROM sport_center.payment_settlement_items i
              WHERE i.settlement_id = payment_settlement_batches.id
                AND i.payment_id = ANY(p_payment_ids)
                AND i.item_status = 'active'
           )
         )
       FOR UPDATE;
`;
    if (patched.includes(oldBatchPredicate)) {
      patched = patched.replace(oldBatchPredicate, newBatchPredicate);
    }
    if (patched !== definition) await client.query(patched);
    await client.query(`
      DROP INDEX IF EXISTS sport_center.payment_settlement_batches_active_group_unique
    `);
    await client.query(`
      CREATE UNIQUE INDEX payment_settlement_batches_active_group_unique
        ON sport_center.payment_settlement_batches
           (company_id, lower(provider_code), bank_account_id,
            settlement_date, settlement_rule_version)
       WHERE status IN ('draft', 'calculated', 'posted', 'reconciled')
         AND settlement_rule_version IS NOT NULL
         AND settlement_reference NOT LIKE 'CF_SC_8_PAYMENT_SCOPED:%'
    `);
    await client.query("COMMIT");
    console.log("CF-SC-8 development payment-scoped settlement owner applied.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} finally {
  await pool.end();
}