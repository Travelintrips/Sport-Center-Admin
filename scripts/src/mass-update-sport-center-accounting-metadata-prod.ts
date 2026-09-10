import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");
const CONFIRM = process.argv.includes("--confirm-mass-update");

if (!APPLY || !PROD || !CONFIRM) {
  console.error(
    "Refusing to run. Use --prod --apply --confirm-mass-update for the approved Production metadata correction.",
  );
  process.exit(1);
}

process.env.NODE_ENV = "production";

const secretResult = await loadSecretsFromGSM();
if (secretResult.fatal.length > 0) {
  console.error("[mass-payment-metadata] Production secret bootstrap failed.");
  process.exit(1);
}

const rawConnectionString = process.env.SUPABASE_DATABASE_URL;
if (!rawConnectionString) {
  console.error("[mass-payment-metadata] Production database URL is unavailable.");
  process.exit(1);
}

const connectionString = rawConnectionString.replace(
  "pooler.supabase.com:6543",
  "pooler.supabase.com:5432",
);
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const target = {
  paymentProvider: "mandiri_direct",
  companyId: 1,
  bankAccountId: "1640006707220",
};

const scriptsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type Summary = {
  total: number;
  amount: string;
  providerMismatch: number;
  companyMismatch: number;
  bankMismatch: number;
  anyMismatch: number;
};

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '120s'");
  await client.query(
    "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
  );
  const correctionGuardSql = await fs.readFile(
    path.join(scriptsDir, "patch_posted_accounting_metadata_correction.sql"),
    "utf8",
  );
  await client.query(correctionGuardSql);

  const identity = (
    await client.query<{
      databaseUser: string;
      transactionReadOnly: string;
    }>(
      `SELECT current_user AS "databaseUser",
              current_setting('transaction_read_only') AS "transactionReadOnly"`,
    )
  ).rows[0];
  if (!identity || identity.transactionReadOnly !== "off") {
    throw new Error("PRODUCTION_WRITE_TRANSACTION_NOT_AVAILABLE");
  }

  const before = (
    await client.query<Summary>(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(debit_amount), 0)::numeric::text AS amount,
        COUNT(*) FILTER (
          WHERE payment_provider IS DISTINCT FROM $1
        )::int AS "providerMismatch",
        COUNT(*) FILTER (
          WHERE company_id IS DISTINCT FROM $2
        )::int AS "companyMismatch",
        COUNT(*) FILTER (
          WHERE bank_account_id IS DISTINCT FROM $3
        )::int AS "bankMismatch",
        COUNT(*) FILTER (
          WHERE payment_provider IS DISTINCT FROM $1
             OR company_id IS DISTINCT FROM $2
             OR bank_account_id IS DISTINCT FROM $3
        )::int AS "anyMismatch"
      FROM sport_center.accounting_journals
      WHERE payment_id IS NOT NULL
        AND journal_type = 'payment_confirmed'
        AND is_reversal = false
    `, [target.paymentProvider, target.companyId, target.bankAccountId])
  ).rows[0];
  if (!before || before.total === 0) {
    throw new Error("NO_ACTIVE_PAYMENT_ACCOUNTING_JOURNALS_FOUND");
  }

  const updated = await client.query<{ id: number }>(
    `UPDATE sport_center.accounting_journals
        SET payment_provider = $1,
            company_id = $2,
            bank_account_id = $3
      WHERE payment_id IS NOT NULL
        AND journal_type = 'payment_confirmed'
        AND is_reversal = false
        AND (
          payment_provider IS DISTINCT FROM $1
          OR company_id IS DISTINCT FROM $2
          OR bank_account_id IS DISTINCT FROM $3
        )
      RETURNING id`,
    [target.paymentProvider, target.companyId, target.bankAccountId],
  );

  const after = (
    await client.query<Summary>(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(debit_amount), 0)::numeric::text AS amount,
        COUNT(*) FILTER (
          WHERE payment_provider IS DISTINCT FROM $1
        )::int AS "providerMismatch",
        COUNT(*) FILTER (
          WHERE company_id IS DISTINCT FROM $2
        )::int AS "companyMismatch",
        COUNT(*) FILTER (
          WHERE bank_account_id IS DISTINCT FROM $3
        )::int AS "bankMismatch",
        COUNT(*) FILTER (
          WHERE payment_provider IS DISTINCT FROM $1
             OR company_id IS DISTINCT FROM $2
             OR bank_account_id IS DISTINCT FROM $3
        )::int AS "anyMismatch"
      FROM sport_center.accounting_journals
      WHERE payment_id IS NOT NULL
        AND journal_type = 'payment_confirmed'
        AND is_reversal = false
    `, [target.paymentProvider, target.companyId, target.bankAccountId])
  ).rows[0];
  if (!after || after.anyMismatch !== 0 || after.total !== before.total) {
    throw new Error("POST_UPDATE_METADATA_VERIFICATION_FAILED");
  }

  const financialIntegrity = (
    await client.query<{
      totalDebit: string;
      totalCredit: string;
      taxAmount: string;
      reversalCount: number;
    }>(`
      SELECT
        COALESCE(SUM(debit_amount), 0)::numeric::text AS "totalDebit",
        COALESCE(SUM(credit_revenue_amount + credit_ppn_amount), 0)::numeric::text AS "totalCredit",
        COALESCE(SUM(credit_ppn_amount), 0)::numeric::text AS "taxAmount",
        COUNT(*) FILTER (WHERE is_reversal = true)::int AS "reversalCount"
      FROM sport_center.accounting_journals
      WHERE payment_id IS NOT NULL
        AND journal_type = 'payment_confirmed'
        AND is_reversal = false
    `)
  ).rows[0];
  if (!financialIntegrity || financialIntegrity.totalDebit !== financialIntegrity.totalCredit) {
    throw new Error("FINANCIAL_TOTALS_CHANGED_OR_UNBALANCED");
  }

  await client.query(
    `INSERT INTO sport_center.audit_logs
      (user_name, user_role, action, entity, before, after)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      "production-metadata-correction",
      "owner-approved-mass-update",
      "ACCOUNTING_PAYMENT_METADATA_MASS_CORRECTION",
      "accounting_journals",
      JSON.stringify({
        scope: "payment_confirmed non-reversal journals",
        total: before.total,
        amount: before.amount,
        providerMismatch: before.providerMismatch,
        companyMismatch: before.companyMismatch,
        bankMismatch: before.bankMismatch,
      }),
      JSON.stringify({
        target,
        updatedRows: updated.rowCount,
        total: after.total,
        amount: after.amount,
        anyMismatch: after.anyMismatch,
        financialIntegrity,
      }),
    ],
  );

  await client.query("COMMIT");
  console.info(
    JSON.stringify({
      environment: "production",
      databaseUser: identity.databaseUser,
      scope: "sport_center.accounting_journals payment_confirmed non-reversal",
      target,
      before,
      updatedRows: updated.rowCount,
      after,
      financialIntegrity,
      auditLogged: true,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("[mass-payment-metadata] Transaction rolled back.", error);
  process.exitCode = 1;
} finally {
  await client.end();
}