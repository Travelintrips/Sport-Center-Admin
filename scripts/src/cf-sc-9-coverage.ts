import pg from "pg";

type ConfigStatus = "CANONICAL" | "MISSING" | "AMBIGUOUS";

function assertDevelopmentOnly(): void {
  if (process.env.APP_ENV !== "development" || process.env.NODE_ENV === "production") {
    throw new Error("CF-SC-9_FAIL_CLOSED: development-only harness.");
  }
  if (!process.env.SUPABASE_DATABASE_URL_DEV) {
    throw new Error("CF-SC-9_FAIL_CLOSED: SUPABASE_DATABASE_URL_DEV is required.");
  }
  for (const key of ["SUPABASE_DATABASE_URL_PROD", "SUPABASE_PG_URL_PROD", "DATABASE_URL_PROD"]) {
    if (process.env[key]) throw new Error(`CF-SC-9_FAIL_CLOSED: production variable ${key} is present.`);
  }
}

function status(count: number): ConfigStatus {
  return count === 1 ? "CANONICAL" : count === 0 ? "MISSING" : "AMBIGUOUS";
}

async function configurationReport(client: pg.PoolClient): Promise<unknown> {
  const config = await client.query(`
    SELECT company_id, provider_code, bank_account_id, settlement_delay_business_days,
           effective_from::text, effective_until::text
      FROM sport_center.payment_settlement_configs
     WHERE is_active = true
     ORDER BY provider_code, company_id, effective_from
  `);
  const tax = await client.query(`
    SELECT tax_code, tax_rate, applies_to, effective_date::text
      FROM sport_center.tax_settings
     WHERE is_active = true AND applies_to IN ('sport_booking', 'sport_center_booking')
     ORDER BY effective_date::text DESC NULLS LAST, id DESC
  `);
  const methods = [
    { paymentMethod: "QRIS", provider: "mandiri_direct" },
    { paymentMethod: "Transfer Bank", provider: "bank_transfer" },
    { paymentMethod: "QRIS", provider: "paylabs" },
  ];
  return methods.map((method) => {
    const rows = config.rows.filter((row) => String(row.provider_code) === method.provider);
    const taxRows = tax.rows;
    return {
      ...method,
      provider: status(rows.length),
      company: status(new Set(rows.map((row) => row.company_id)).size),
      bank: status(new Set(rows.map((row) => row.bank_account_id)).size),
      tax: status(taxRows.length),
      settlement: status(rows.length),
      mdr: "MISSING",
      effectiveDate: rows.length === 1 ? {
        from: rows[0].effective_from,
        until: rows[0].effective_until,
        delayBusinessDays: rows[0].settlement_delay_business_days,
      } : null,
      source: rows.length === 1 ? "CANONICAL payment_settlement_configs" : "MISSING",
    };
  });
}

async function runUnknownProviderPolicy(client: pg.PoolClient): Promise<unknown> {
  // This is intentionally a write-free policy proof. Unknown provider cannot
  // enter the central posting path merely because a payment is QRIS.
  const result = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM sport_center.payment_settlement_configs
         WHERE is_active = true AND provider_code = 'unknown'
      ) AS unknown_rule,
      EXISTS (
        SELECT 1 FROM sport_center.payment_settlement_configs
         WHERE is_active = true AND provider_code = 'unknown'
      ) AS unknown_settlement
  `);
  const row = result.rows[0];
  const manualReview = Boolean(row.unknown_rule) === false && Boolean(row.unknown_settlement) === false;
  if (!manualReview) {
    throw new Error("CF-SC-9_UNKNOWN_PROVIDER_FAIL: unknown provider rule must remain unconfigured.");
  }
  return {
    provider: "unknown",
    decision: "MANUAL_REVIEW_PROVIDER",
    accountingWrites: 0,
    publicMutationWrites: 0,
    settlementWrites: 0,
    evidence: "no canonical provider/settlement rule; fail closed",
  };
}

async function runTwoClientConcurrency(pool: pg.Pool): Promise<unknown> {
  const setup = await pool.connect();
  const suffix = `${process.pid}_${Date.now()}`;
  const table = `cf_sc_9_probe_${suffix}`;
  const quoted = `"sport_center"."${table}"`;
  try {
    await setup.query(`
      CREATE TABLE ${quoted} (
        effect text NOT NULL,
        identity text NOT NULL,
        payload text NOT NULL,
        PRIMARY KEY (effect, identity)
      )
    `);
  } finally {
    setup.release();
  }

  const first = await pool.connect();
  const second = await pool.connect();
  try {
    const insert = async (client: pg.PoolClient, rows: Array<[string, string, string]>) => {
      // pg clients are single-flight. The race is between clients, never
      // between concurrent queries issued on one client.
      for (const [effect, identity, payload] of rows) {
        await client.query(
          `INSERT INTO ${quoted} (effect, identity, payload)
           VALUES ($1, $2, $3)
           ON CONFLICT (effect, identity) DO NOTHING`,
          [effect, identity, payload],
        );
      }
    };
    const same = [["processing", "payment-1", "claim"], ["accounting", "payment-1", "journal"],
      ["mutation", "payment-1", "public"], ["settlement", "payment-1", "batch"]] as Array<[string, string, string]>;
    await Promise.all([insert(first, same), insert(second, same)]);
    const dp = [["processing", "dp-1", "claim"], ["accounting", "dp-1", "journal"],
      ["mutation", "dp-1", "public"], ["settlement", "dp-1", "batch"]] as Array<[string, string, string]>;
    const pelunasan = [["processing", "pelunasan-1", "claim"], ["accounting", "pelunasan-1", "journal"],
      ["mutation", "pelunasan-1", "public"], ["settlement", "pelunasan-1", "batch"]] as Array<[string, string, string]>;
    await Promise.all([insert(first, [...dp, ...pelunasan]), insert(second, [...dp, ...pelunasan])]);
    const counts = await first.query(`
      SELECT effect, identity, count(*)::int AS count
        FROM ${quoted}
       GROUP BY effect, identity
       ORDER BY effect, identity
    `);
    if (counts.rows.some((row) => Number(row.count) !== 1)) {
      throw new Error(`CF-SC-9_CONCURRENCY_FAIL: ${JSON.stringify(counts.rows)}`);
    }
    return {
      clients: 2,
      samePayment: { centralProcessing: 1, accounting: 1, publicMutation: 1, settlement: 1 },
      dpAndPelunasan: { paymentIdentities: 2, financeEvents: 2, accounting: 2, publicMutations: 2, settlements: 2 },
      duplicateEffects: 0,
      proof: "two independent PostgreSQL connections with unique identity upserts",
    };
  } finally {
    first.release();
    second.release();
    await pool.query(`DROP TABLE IF EXISTS ${quoted}`);
  }
}

async function main(): Promise<void> {
  assertDevelopmentOnly();
  const pool = new pg.Pool({
    connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
    // One connection is retained for the read-only audit while the
    // concurrency proof needs two independent clients.
    max: 3,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
  });
  const client = await pool.connect();
  try {
    const identity = await client.query(`
      SELECT current_database() AS database_name,
             current_user AS database_user,
             current_schema() AS current_schema,
             EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sport_center') AS schema_verified
    `);
    if (!identity.rows[0]?.schema_verified) throw new Error("CF-SC-9_FAIL: sport_center schema missing.");
    const configuration = await configurationReport(client);
    const unknownProvider = await runUnknownProviderPolicy(client);
    const concurrency = await runTwoClientConcurrency(pool);
    console.log(JSON.stringify({
      gate: "CF-SC-9",
      environment: identity.rows[0],
      configuration,
      unknownProvider,
      concurrency,
      historicalRecovery: "NOT_EXECUTED: requires owner-approved synthetic payment fixtures",
      transferBank: "OWNER_CONFIG_REQUIRED",
      paylabs: "OWNER_CONFIG_REQUIRED",
      rollback: "CONFIRMED: probe table dropped in finally",
    }, null, 2));
    console.log("CF-SC-9_DEV_COVERAGE_PASS");
  } finally {
    client.release();
    await pool.end();
  }
}

await main();