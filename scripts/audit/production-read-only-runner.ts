import pg from "pg";
import { loadProductionAuditDatabaseSecretFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

/**
 * Production record-level audit runner.
 *
 * This runner intentionally does not load the application database resolver or
 * any application pool. The only accepted connection variable is the
 * separately provisioned SUPABASE_PROD_AUDIT_DATABASE_URL.
 *
 * Until the dedicated role and secret exist, this command must fail before
 * opening a production connection. It is not a remediation or repair tool.
 */

const AUDIT_ROLE = "sport_center_production_auditor";
const MUTATION_WORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|COPY|VACUUM|REFRESH|COMMENT)\b/i;

type Row = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`PRODUCTION_AUDIT_FAIL_CLOSED: ${message}`);
}

function requireAuditEnvironment(): string {
  if (process.env.NODE_ENV !== "production-audit") {
    fail("NODE_ENV must be exactly production-audit.");
  }

  const auditUrl = process.env.SUPABASE_PROD_AUDIT_DATABASE_URL;
  if (!auditUrl) fail("SUPABASE_PROD_AUDIT_DATABASE_URL is required.");

  for (const key of [
    "SUPABASE_DATABASE_URL",
    "SUPABASE_DATABASE_URL_DEV",
    "DATABASE_URL",
    "SUPABASE_PG_URL",
  ]) {
    if (process.env[key] && process.env[key] === auditUrl) {
      fail(`dedicated audit URL must not equal ${key}.`);
    }
  }

  if (process.env.SUPABASE_DATABASE_URL_DEV &&
      auditUrl === process.env.SUPABASE_DATABASE_URL_DEV) {
    fail("development URL cannot be used as the audit URL.");
  }

  // Reject an obvious development URL even when the application variables
  // have not been injected into this isolated process.
  if (/(^|[._-])(dev|development)([._:-]|$)/i.test(auditUrl)) {
    fail("audit URL appears to identify a development database.");
  }

  return auditUrl;
}

function assertSelect(sql: string): void {
  const normalized = sql.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").trim();
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    fail("audit statements must start with SELECT or WITH.");
  }
  if (MUTATION_WORDS.test(normalized)) {
    fail("mutation or DDL keyword detected in audit statement.");
  }
  if (normalized.includes(";")) {
    fail("one statement per audit query is required.");
  }
}

async function select<T extends Row>(
  client: pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertSelect(sql);
  return (await client.query<T>(sql, params)).rows;
}

const requiredTables = [
  ["sport_center", "sport_bookings"],
  ["sport_center", "sport_payments"],
  ["sport_center", "booking_history"],
  ["sport_center", "payment_accounting_outbox"],
  ["sport_center", "company_invoices"],
  ["sport_center", "company_invoice_items"],
  ["sport_center", "accounting_journals"],
  ["sport_center", "accounting_journal_lines"],
  ["sport_center", "bank_mutations"],
  ["sport_center", "bank_reconciliation_matches"],
  ["sport_center", "tax_transactions"],
  ["sport_center", "corporate_subscriptions"],
  ["sport_center", "corporate_occurrences"],
  ["sport_center", "usage_proofs"],
  ["public", "accounting_entries"],
  ["public", "accounting_entry_lines"],
] as const;

async function main(): Promise<void> {
  if (!process.env.SUPABASE_PROD_AUDIT_DATABASE_URL) {
    const secretResult = await loadProductionAuditDatabaseSecretFromGSM();
    if (secretResult.fatal.length > 0) {
      fail(secretResult.fatal.join("; "));
    }
  }
  const connectionString = requireAuditEnvironment();
  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");

    const mode = await select<{ transaction_read_only: string }>(
      client,
      "SELECT current_setting('transaction_read_only') AS transaction_read_only",
    );
    if (mode[0]?.transaction_read_only !== "on") {
      fail("transaction_read_only is not on.");
    }

    const identity = await select<{
      database_name: string;
      database_user: string;
      server_port: number;
    }>(
      client,
      "SELECT current_database() AS database_name, current_user AS database_user, inet_server_port() AS server_port",
    );
    if (identity[0]?.database_user !== AUDIT_ROLE) {
      fail(`connected role is not ${AUDIT_ROLE}.`);
    }

    const available = await select<{ table_schema: string; table_name: string }>(
      client,
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_schema IN ('sport_center', 'public')
          AND table_type = 'BASE TABLE'
        ORDER BY table_schema, table_name`,
    );
    const availableKeys = new Set(available.map((row) => `${row.table_schema}.${row.table_name}`));
    const scope = requiredTables.map(([schema, table]) => ({
      schema,
      table,
      present: availableKeys.has(`${schema}.${table}`),
    }));
    const featureColumns = await select<{
      table_name: string;
      column_name: string;
    }>(
      client,
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'sport_center'
          AND table_name IN ('corporate_subscriptions', 'corporate_occurrences', 'usage_proofs')
        ORDER BY table_name, ordinal_position`,
    );
    const featureIndexes = await select<{
      index_name: string;
      table_name: string;
    }>(
      client,
      `SELECT indexname AS index_name, tablename AS table_name
         FROM pg_catalog.pg_indexes
        WHERE schemaname = 'sport_center'
          AND tablename IN ('corporate_subscriptions', 'corporate_occurrences', 'usage_proofs')
        ORDER BY tablename, indexname`,
    );
    const featurePrivileges = await select<{
      schema_usage: boolean;
      subscriptions_select: boolean;
      occurrences_select: boolean;
      usage_proofs_select: boolean;
    }>(
      client,
      `SELECT has_schema_privilege(current_user, 'sport_center', 'USAGE') AS schema_usage,
              has_table_privilege(current_user, 'sport_center.corporate_subscriptions', 'SELECT') AS subscriptions_select,
              has_table_privilege(current_user, 'sport_center.corporate_occurrences', 'SELECT') AS occurrences_select,
              has_table_privilege(current_user, 'sport_center.usage_proofs', 'SELECT') AS usage_proofs_select`,
    );

    // This initial runner phase proves the safe connection and discovers the
    // audit surface. Record-level classification queries are deliberately not
    // started until the dedicated infrastructure is provisioned and verified.
    console.log(JSON.stringify({
      gate: "PRODUCTION_READ_ONLY_AUDIT",
      access: "PASS",
      transaction_read_only: mode[0]?.transaction_read_only,
      identity: identity[0],
      auditRole: AUDIT_ROLE,
      scope,
      featureColumns,
      featureIndexes,
      featurePrivileges: featurePrivileges[0] ?? null,
      mutationQueries: 0,
      transaction: "ROLLBACK_REQUIRED",
      classification: "NOT_EXECUTED_IN_GATE_PHASE",
    }, null, 2));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

await main();