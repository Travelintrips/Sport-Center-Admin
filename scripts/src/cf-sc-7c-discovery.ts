import pg from "pg";

/**
 * CF-SC-7C — Canonical Finance Configuration Discovery
 *
 * This command is intentionally read-only. It is a discovery/reporting tool,
 * not a seed script and not a fixture factory. It uses the DEV Supabase
 * connection only and sets the transaction to READ ONLY before querying.
 */

type Row = Record<string, unknown>;
type Shape = {
  key: string;
  paymentMethod: string;
  provider: string;
  paymentType: string;
  appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" | "NOT_SUPPORTED" | "LEGACY_ONLY" | "UNKNOWN";
};

const SHAPES: Shape[] = [
  { key: "qris_full", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "full_payment", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "transfer_full", paymentMethod: "Transfer Bank", provider: "bank_transfer", paymentType: "full_payment", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "paylabs_full", paymentMethod: "QRIS", provider: "paylabs", paymentType: "full_payment", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "qris_dp", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "dp", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "qris_pelunasan", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "pelunasan", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "transfer_dp", paymentMethod: "Transfer Bank", provider: "bank_transfer", paymentType: "dp", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "transfer_pelunasan", paymentMethod: "Transfer Bank", provider: "bank_transfer", paymentType: "pelunasan", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "group_payment", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "full_payment", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
  { key: "historical_recovery", paymentMethod: "QRIS", provider: "mandiri_direct", paymentType: "full_payment", appSupport: "LEGACY_ONLY" },
  { key: "provider_unknown", paymentMethod: "QRIS", provider: "unknown", paymentType: "full_payment", appSupport: "SUPPORTED_BUT_NO_DEV_FIXTURE" },
];

function requireDev(): void {
  if (process.env.APP_ENV !== "development") throw new Error("CF-SC-7C_FAIL_CLOSED: APP_ENV must be exactly development.");
  if (process.env.NODE_ENV === "production") throw new Error("CF-SC-7C_FAIL_CLOSED: NODE_ENV=production is forbidden.");
  if (!process.env.SUPABASE_DATABASE_URL_DEV) throw new Error("CF-SC-7C_FAIL_CLOSED: SUPABASE_DATABASE_URL_DEV is required.");
  for (const key of ["SUPABASE_DATABASE_URL_PROD", "SUPABASE_PG_URL_PROD", "DATABASE_URL_PROD"]) {
    if (process.env[key]) throw new Error(`CF-SC-7C_FAIL_CLOSED: production database variable ${key} is present.`);
  }
}

const ident = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;
const text = (value: unknown): string | null => value == null ? null : String(value);
const bool = (value: unknown): boolean | null => value == null ? null : value === true || value === "t" || value === "true";
const redactAccount = (value: unknown): string | null => {
  const account = text(value);
  if (!account) return null;
  return account.length <= 4 ? "REDACTED" : `${"*".repeat(Math.max(4, account.length - 4))}${account.slice(-4)}`;
};

async function main(): Promise<void> {
  requireDev();
  const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL_DEV, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  const report: Record<string, unknown> = {};

  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const identity = await client.query(`
      SELECT current_database() AS database_name, current_user AS database_user,
             current_schema() AS current_schema, inet_server_port() AS server_port,
             EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sport_center') AS has_sport_center
    `);
    if (!identity.rows[0]?.has_sport_center) throw new Error("CF-SC-7C_FAIL_CLOSED: sport_center schema was not verified.");

    const exists = async (schema: string, table: string) => (await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2) AS present`, [schema, table],
    )).rows[0]?.present === true;
    const columns = async (schema: string, table: string) => (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table],
    )).rows.map((r) => String(r.column_name));
    let savepointId = 0;
    const optionalQuery = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
      const savepoint = `cf_sc_7c_probe_${++savepointId}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await client.query(sql, params);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result.rows;
      } catch {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return [];
      }
    };
    const select = async (schema: string, table: string, requested: string[], where = "", params: unknown[] = [], limit = 500): Promise<Row[]> => {
      if (!await exists(schema, table)) return [];
      const available = new Set(await columns(schema, table));
      const selected = requested.filter((column) => available.has(column));
      if (!selected.length) return [];
      return optionalQuery(
        `SELECT ${selected.map(ident).join(", ")} FROM ${ident(schema)}.${ident(table)} ${where} LIMIT ${Math.max(1, Math.min(limit, 5000))}`,
        params,
      );
    };
    const count = async (schema: string, table: string, where = "", params: unknown[] = []) => {
      if (!await exists(schema, table)) return 0;
      return Number((await optionalQuery(`SELECT count(*)::int AS count FROM ${ident(schema)}.${ident(table)} ${where}`, params))[0]?.count ?? 0);
    };

    const candidateTables = await client.query(`
      SELECT table_schema, table_name
        FROM information_schema.tables
       WHERE table_schema IN ('public','sport_center')
         AND (table_name ILIKE '%compan%' OR table_name ILIKE '%payment%' OR table_name ILIKE '%settle%'
           OR table_name ILIKE '%tax%' OR table_name ILIKE '%coa%' OR table_name ILIKE '%account%'
           OR table_name ILIKE '%bank%' OR table_name ILIKE '%booking%' OR table_name ILIKE '%paylab%')
       ORDER BY table_schema, table_name
    `);
    const enumTypes = await client.query(`
      SELECT n.nspname AS schema_name, t.typname AS type_name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        JOIN pg_enum e ON e.enumtypid=t.oid
       WHERE n.nspname IN ('public','sport_center')
         AND (t.typname ILIKE '%payment%' OR t.typname ILIKE '%settle%' OR t.typname ILIKE '%tax%')
       GROUP BY n.nspname,t.typname ORDER BY n.nspname,t.typname
    `);
    report.schema = {
      tables: candidateTables.rows,
      enums: enumTypes.rows,
      relevantColumns: {
        sportPayments: await columns("sport_center", "sport_payments"),
        sportBookings: await columns("sport_center", "sport_bookings"),
        paymentSettlementConfigs: await columns("sport_center", "payment_settlement_configs"),
        taxSettings: await columns("sport_center", "tax_settings"),
      },
    };

    const companies = await select("public", "companies", ["id", "code", "name", "is_active", "created_at"]);
    const facilities = await select("sport_center", "facilities", ["id", "name", "is_active", "company_id"]);
    const mappings = await select("sport_center", "facility_company_mappings", [
      "id", "facility_id", "company_id", "effective_from", "effective_until", "is_active", "evidence_source", "evidence_reference",
    ]);
    const bookingOwnership = await optionalQuery(`
      SELECT company_id, count(*)::int AS row_count
        FROM sport_center.sport_bookings
       GROUP BY company_id ORDER BY company_id NULLS FIRST
    `);
    const paymentOwnership = await optionalQuery(`
      SELECT company_id, count(*)::int AS row_count
        FROM sport_center.sport_payments
       GROUP BY company_id ORDER BY company_id NULLS FIRST
    `);
    report.companyOwnership = { companies, facilities, facilityCompanyMappings: mappings, bookingOwnership, paymentOwnership };

    const settingsTables = ["sport_settings", "payment_methods", "payment_method_configs", "payment_providers", "accounting_settings"];
    const settings: Record<string, Row[]> = {};
    for (const table of settingsTables) settings[table] = await select("sport_center", table, ["id", "key", "name", "code", "value", "payment_method", "provider_code", "is_active", "company_id"]);
    const configuredMethods = [...new Set([
      ...settingsTables.flatMap((table) => settings[table].flatMap((r) => [text(r.payment_method), text(r.name), text(r.code)])),
      ... (await select("sport_center", "payment_settlement_configs", ["provider_code", "is_active"])).map((r) => text(r.provider_code)),
    ].filter((v): v is string => Boolean(v)))].sort();
    const actualMethods = await optionalQuery(`SELECT payment_method, count(*)::int AS row_count FROM sport_center.sport_payments GROUP BY payment_method ORDER BY payment_method`);
    const applicationMethods = ["QRIS", "Transfer Bank", "Cash"];
    report.paymentMethods = {
      configured: configuredMethods,
      actualDevPayments: actualMethods,
      applicationContract: applicationMethods,
      comparison: [...new Set([...configuredMethods, ...actualMethods.map((r) => text(r.payment_method)), ...applicationMethods].filter((v): v is string => Boolean(v)))].sort().map((method) => ({
        method,
        classification: configuredMethods.includes(method) && actualMethods.some((r) => text(r.payment_method) === method) ? "CONFIGURED_AND_USED"
          : configuredMethods.includes(method) ? "CONFIGURED_NOT_USED"
          : actualMethods.some((r) => text(r.payment_method) === method) ? "USED_NOT_CONFIGURED"
          : "APPLICATION_ONLY",
      })),
      settings,
    };

    const bankAccounts = await select("public", "company_bank_accounts", ["id", "company_id", "bank_name", "name", "account_number", "coa_id", "is_active"]);
    const settlements = await select("sport_center", "payment_settlement_configs", [
      "id", "company_id", "provider_code", "bank_account_id", "settlement_delay_business_days", "effective_from", "effective_until", "is_active", "source",
    ], "WHERE is_active = true ORDER BY effective_from DESC");
    const taxes = await select("sport_center", "tax_settings", [
      "id", "company_id", "project", "applies_to", "tax_code", "tax_type", "tax_rate", "is_inclusive", "effective_date", "effective_from", "effective_until", "is_active",
    ], "WHERE is_active = true ORDER BY id");
    const coa = await select("sport_center", "coa_accounts", ["id", "code", "name", "account_type", "is_active"], "WHERE is_active = true ORDER BY code");
    const publicCoa = await select("public", "accounting_accounts", ["id", "code", "name", "account_type", "is_active"]);
    const safeSettlements = settlements.map((row) => ({
      ...row,
      bank_account_id: redactAccount(row.bank_account_id),
      bank_account_identity: bankAccounts.find((account) => text(account.id) === text(row.bank_account_id))
        ? {
          bank_name: bankAccounts.find((account) => text(account.id) === text(row.bank_account_id))?.bank_name ?? null,
          name: bankAccounts.find((account) => text(account.id) === text(row.bank_account_id))?.name ?? null,
        }
        : null,
    }));
    report.financeConfiguration = {
      receivingBankAccounts: bankAccounts.map(({ account_number: _redacted, ...row }) => row),
      activeSettlementConfigs: safeSettlements,
      activeTaxConfigs: taxes,
      sportCenterCoa: coa,
      publicAccountingAccounts: publicCoa,
      coaMapping: { source: publicCoa.length ? "public.accounting_accounts" : coa.length ? "sport_center.coa_accounts" : null, rows: publicCoa.length || coa.length ? [...publicCoa, ...coa] : [] },
    };

    const providers = await optionalQuery(`
      SELECT payment_provider::text AS provider, payment_method, count(*)::int AS row_count,
             count(*) FILTER (WHERE company_id IS NOT NULL)::int AS company_rows,
             count(*) FILTER (WHERE bank_account_id IS NOT NULL AND btrim(bank_account_id) <> '')::int AS bank_rows
        FROM sport_center.sport_payments
       GROUP BY payment_provider::text, payment_method ORDER BY provider, payment_method
    `);
    report.providers = {
      applicationContract: ["mandiri_direct", "paylabs", "unknown"],
      configured: [...new Set(settlements.map((r) => text(r.provider_code)).filter((v): v is string => Boolean(v)))],
      actualDevPayments: providers,
      paylabsIdentities: await select("sport_center", "paylabs_transactions", ["id", "booking_id", "order_number", "payment_method", "status", "provider_status", "paid_at", "created_at"]),
    };

    const shapeRows: Row[] = [];
    for (const shape of SHAPES) {
      const params = [shape.paymentMethod, shape.paymentType, shape.provider];
      const where = `WHERE payment_method = $1 AND payment_type::text = $2 AND COALESCE(payment_provider::text, 'unknown') = $3`;
      const rowCount = await count("sport_center", "sport_payments", where, params);
      const hasCompany = bookingOwnership.some((r) => r.company_id != null) || paymentOwnership.some((r) => r.company_id != null);
      const providerConfigured = settlements.some((r) => text(r.provider_code) === shape.provider);
      const bankConfigured = bankAccounts.some((r) => bool(r.is_active) && r.company_id != null);
      const taxConfigured = taxes.length === 1;
      const coaConfigured = publicCoa.length > 0 || coa.length > 0;
      const fixturePossible = shape.appSupport !== "NOT_SUPPORTED" && shape.appSupport !== "LEGACY_ONLY" && Boolean(hasCompany && providerConfigured && bankConfigured && taxConfigured && coaConfigured);
      const classification = shape.appSupport === "NOT_SUPPORTED" ? "NOT_SUPPORTED"
        : shape.appSupport === "LEGACY_ONLY" ? "LEGACY_ONLY"
        : !hasCompany || !providerConfigured || !bankConfigured || !taxConfigured || !coaConfigured ? "BLOCKED_CONFIG_MISSING"
        : rowCount > 0 ? "READY_FOR_ROLLBACK_FIXTURE"
        : fixturePossible ? "READY_FOR_ROLLBACK_FIXTURE" : "BLOCKED_AMBIGUOUS";
      shapeRows.push({
        paymentShape: shape.key, appSupport: shape.appSupport, devRowExists: rowCount > 0, devRowCount: rowCount,
        companyConfig: hasCompany, providerConfig: providerConfigured, bankConfig: bankConfigured,
        taxConfig: taxConfigured, coaConfig: coaConfigured, settlementConfig: providerConfigured,
        fixturePossible, classification,
      });
    }
    report.paymentShapeMatrix = shapeRows;

    const unknown = await count("sport_center", "sport_payments", "WHERE payment_provider IS NULL OR payment_provider::text IN ('', 'unknown')");
    report.contractDiscovery = {
      supportedPaymentTypes: ["full_payment", "dp", "pelunasan"],
      supportedProviders: ["mandiri_direct", "paylabs", "unknown"],
      sourceEvidence: ["scripts/src/cf-sc-7ab-harness.ts", "artifacts/api-server/src/lib/paymentProvider.ts", "artifacts/api-server/src/routes/payments.ts"],
      providerUnknownRows: unknown,
    };
    report.ownerDecisionsRequired = shapeRows.filter((r) => r.classification === "BLOCKED_CONFIG_MISSING").map((r) => ({
      paymentShape: r.paymentShape,
      missing: Object.entries(r).filter(([key, value]) => ["companyConfig", "providerConfig", "bankConfig", "taxConfig", "coaConfig", "settlementConfig"].includes(key) && value === false).map(([key]) => key),
    }));
    report.environment = { ...identity.rows[0], appEnv: process.env.APP_ENV, nodeEnv: process.env.NODE_ENV ?? null };
    report.mutationPolicy = { inserts: 0, updates: 0, deletes: 0, ddl: 0, transaction: "READ ONLY; rolled back" };

    await client.query("ROLLBACK");
    console.log(JSON.stringify(report, null, 2));
    console.log("CF-SC-7C_READ_ONLY_ROLLBACK_CONFIRMED");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();