import pg from "pg";

type FixtureKind =
  | "qris_full"
  | "transfer_full"
  | "paylabs_full"
  | "qris_dp"
  | "qris_pelunasan"
  | "transfer_dp"
  | "transfer_pelunasan"
  | "group_payment"
  | "historical_recovery"
  | "provider_unknown";

type FixtureStatus = "CONTROL_AVAILABLE" | "BLOCKED_CONFIG_MISSING";

type Fixture = {
  kind: FixtureKind;
  paymentMethod: "QRIS" | "Transfer Bank";
  provider: string;
  paymentType: "full_payment" | "dp" | "pelunasan";
};

const fixtures: Fixture[] = [
  { kind: "qris_full", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "full_payment" },
  { kind: "transfer_full", paymentMethod: "Transfer Bank", provider: "bank_transfer", paymentType: "full_payment" },
  { kind: "paylabs_full", paymentMethod: "QRIS", provider: "paylabs", paymentType: "full_payment" },
  { kind: "qris_dp", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "dp" },
  { kind: "qris_pelunasan", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "pelunasan" },
  { kind: "transfer_dp", paymentMethod: "Transfer Bank", provider: "bank_transfer", paymentType: "dp" },
  { kind: "transfer_pelunasan", paymentMethod: "Transfer Bank", provider: "bank_transfer", paymentType: "pelunasan" },
  { kind: "group_payment", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "full_payment" },
  { kind: "historical_recovery", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "full_payment" },
  { kind: "provider_unknown", paymentMethod: "QRIS", provider: "unknown", paymentType: "full_payment" },
];

function assertDevelopmentOnly(): void {
  if (process.env.APP_ENV !== "development") {
    throw new Error("CF-SC-7AB_FAIL_CLOSED: APP_ENV must be exactly development.");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CF-SC-7AB_FAIL_CLOSED: NODE_ENV=production is forbidden.");
  }
  if (!process.env.SUPABASE_DATABASE_URL_DEV) {
    throw new Error("CF-SC-7AB_FAIL_CLOSED: SUPABASE_DATABASE_URL_DEV is required.");
  }
  for (const key of ["SUPABASE_DATABASE_URL_PROD", "SUPABASE_PG_URL_PROD", "DATABASE_URL_PROD"]) {
    if (process.env[key]) {
      throw new Error(`CF-SC-7AB_FAIL_CLOSED: production database variable ${key} is present.`);
    }
  }
}

async function main(): Promise<void> {
  assertDevelopmentOnly();

  const pool = new pg.Pool({
    connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  const client = await pool.connect();

  try {
    const identity = await client.query(
      `SELECT current_database() AS database_name,
              current_user AS database_user,
              EXISTS (
                SELECT 1 FROM information_schema.schemata
                WHERE schema_name = 'sport_center'
              ) AS has_sport_center_schema`,
    );
    if (!identity.rows[0]?.has_sport_center_schema) {
      throw new Error("CF-SC-7AB_FAIL_CLOSED: DEV sport_center schema was not verified.");
    }

    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE cf_sc_7ab_fixture_registry (
        fixture_kind text PRIMARY KEY,
        payment_method text NOT NULL,
        provider text NOT NULL,
        payment_type text NOT NULL,
        status text NOT NULL,
        reason text NOT NULL
      ) ON COMMIT DROP
    `);

    const configRows = await client.query(
      `SELECT company_id, provider_code, bank_account_id, effective_from, effective_until
         FROM sport_center.payment_settlement_configs
        WHERE is_active = true`,
    );
    const taxRows = await client.query(
      `SELECT tax_code, tax_rate
         FROM sport_center.tax_settings
        WHERE is_active = true
          AND applies_to = 'sport_booking'`,
    );
    const hasMandiriConfig = configRows.rows.some((row) => String(row.provider_code) === "mandiri_direct");
    const hasTaxConfig = taxRows.rows.length === 1;

    for (const fixture of fixtures) {
      const available = fixture.kind === "qris_full" && hasMandiriConfig && hasTaxConfig;
      const status: FixtureStatus = available ? "CONTROL_AVAILABLE" : "BLOCKED_CONFIG_MISSING";
      const reason = available
        ? "canonical DEV settlement and tax configuration resolved; CF-SC-6 control"
        : "fixture factory is intentionally fail-closed until the required canonical shape/configuration is available";
      await client.query(
        `INSERT INTO cf_sc_7ab_fixture_registry
          (fixture_kind, payment_method, provider, payment_type, status, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fixture.kind, fixture.paymentMethod, fixture.provider, fixture.paymentType, status, reason],
      );
    }

    const result = await client.query(
      `SELECT fixture_kind, payment_method, provider, payment_type, status, reason
         FROM cf_sc_7ab_fixture_registry
        ORDER BY fixture_kind`,
    );
    console.log(JSON.stringify({
      environment: {
        appEnv: process.env.APP_ENV,
        nodeEnv: process.env.NODE_ENV ?? null,
        database: identity.rows[0].database_name,
        schemaVerified: identity.rows[0].has_sport_center_schema,
      },
      configuration: {
        activeSettlementConfigs: configRows.rows.length,
        activeSportBookingTaxConfigs: taxRows.rows.length,
      },
      fixtures: result.rows,
      mutationPolicy: "all registry rows are temporary and rollback-only; no payment or accounting rows are inserted",
    }, null, 2));

    await client.query("ROLLBACK");
    console.log("CF-SC-7AB_ROLLBACK_CONFIRMED");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();