import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");

if (!APPLY || !PROD) {
  console.error(
    "Refusing to run. Use --prod --apply to install the payment-accounting trigger migration.",
  );
  process.exit(1);
}

process.env.NODE_ENV = "production";

const secretResult = await loadSecretsFromGSM();
if (secretResult.fatal.length > 0) {
  console.error("[payment-accounting-sync] Production secret bootstrap failed.");
  process.exit(1);
}

const rawConnectionString = process.env.SUPABASE_DATABASE_URL;
if (!rawConnectionString) {
  console.error("[payment-accounting-sync] Production database URL is unavailable.");
  process.exit(1);
}

// Provision through the exact runtime connection. Rewriting the Supabase
// transaction-pooler port to the session-pooler port can verify a different
// catalog view than the one used by the published API.
const connectionString = rawConnectionString;
const { Client } = pg;
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const scriptsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const migrationFiles = [
  "patch_resolve_function.sql",
  "patch_internal_payment_journal_metadata_sync.sql",
  "patch_public_payment_entry_metadata_sync.sql",
  "patch_manual_provider_mirror_function.sql",
];

try {
  await client.connect();
  await client.query("BEGIN");
  // Serialize replace-in-place function updates with another provisioning run
  // or a concurrent startup migration against the same Supabase database.
  await client.query("SELECT pg_advisory_xact_lock(918274615)");

  await client.query(`
    ALTER TABLE sport_center.accounting_journals
      ADD COLUMN IF NOT EXISTS provider_name text,
      ADD COLUMN IF NOT EXISTS provider_id text,
      ADD COLUMN IF NOT EXISTS expected_settlement_date text,
      ADD COLUMN IF NOT EXISTS settlement_status text,
      ADD COLUMN IF NOT EXISTS mdr_rate numeric(8,5),
      ADD COLUMN IF NOT EXISTS mdr_amount numeric(14,2)
  `);
  await client.query(`
    UPDATE sport_center.accounting_journals aj
       SET payment_method = sp.payment_method,
           payment_provider = sp.payment_provider::text,
           provider_name = sp.provider_name,
           provider_id = sp.provider_id,
           payment_type = sp.payment_type::text,
           bank_account_id = sp.bank_account_id,
           expected_settlement_date = sp.expected_settlement_date,
           settlement_status = sp.settlement_status,
           mdr_rate = sp.mdr_rate,
           mdr_amount = sp.mdr_amount,
           provider_reference = sp.provider_reference,
           provider_order_id = sp.provider_order_id,
           merchant_trade_no = sp.merchant_trade_no,
           provider_trade_no = sp.provider_trade_no,
           company_id = COALESCE(sp.company_id, aj.company_id)
      FROM sport_center.sport_payments sp
     WHERE aj.payment_id = sp.id
       AND aj.journal_type = 'payment_confirmed'
       AND aj.is_reversal = false
  `);

  for (const file of migrationFiles) {
    const sql = await fs.readFile(path.join(scriptsDir, file), "utf8");
    await client.query(sql);
  }

  const verification = await client.query<{
    resolver_exists: boolean;
    resolver_supports_manual_provider: boolean;
    mirror_trigger_exists: boolean;
    mirror_supports_manual_metadata_correction: boolean;
    internal_journal_trigger_exists: boolean;
    public_entry_trigger_exists: boolean;
  }>(`
    SELECT
      to_regprocedure('sport_center.resolve_and_persist_payment_metadata(integer)') IS NOT NULL
        AS resolver_exists,
      COALESCE(
        POSITION(
          'v_provider_code = ''unknown'''
          IN pg_get_functiondef(
            to_regprocedure('sport_center.resolve_and_persist_payment_metadata(integer)')
          )
        ) > 0,
        FALSE
      ) AS resolver_supports_manual_provider,
      EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'sport_center'
          AND r.relname = 'sport_payments'
          AND t.tgname = 'trg_mirror_confirmed_payment_to_public'
          AND NOT t.tgisinternal
          AND p.proname = 'mirror_confirmed_payment_to_public'
          AND t.tgenabled IN ('O', 'A')
      ) AS mirror_trigger_exists,
      COALESCE(
        POSITION(
          'v_provider_code = ''unknown'''
          IN pg_get_functiondef(
            to_regprocedure('sport_center.mirror_confirmed_payment_to_public()')
          )
        ) > 0
        AND POSITION(
          'allow_posted_payment_metadata_correction'
          IN pg_get_functiondef(
            to_regprocedure('sport_center.mirror_confirmed_payment_to_public()')
          )
        ) > 0,
        FALSE
      ) AS mirror_supports_manual_metadata_correction,
      EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'sport_center'
          AND r.relname = 'sport_payments'
          AND t.tgname = 'trg_sync_payment_accounting_journal'
          AND NOT t.tgisinternal
          AND p.proname = 'sync_payment_accounting_journal'
          AND t.tgenabled IN ('O', 'A')
      ) AS internal_journal_trigger_exists,
      EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class r ON r.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public'
          AND r.relname = 'sport_payments'
          AND t.tgname = 'trg_sync_sport_payment_entry_metadata'
          AND NOT t.tgisinternal
          AND p.proname = 'sync_sport_payment_entry_metadata'
          AND t.tgenabled IN ('O', 'A')
      ) AS public_entry_trigger_exists
  `);

  const state = verification.rows[0];
  if (
    !state?.resolver_exists ||
    !state.resolver_supports_manual_provider ||
    !state.mirror_trigger_exists ||
    !state.mirror_supports_manual_metadata_correction ||
    !state.internal_journal_trigger_exists ||
    !state.public_entry_trigger_exists
  ) {
    throw new Error("PAYMENT_ACCOUNTING_TRIGGER_VERIFICATION_FAILED");
  }

  await client.query("COMMIT");
  console.info("[payment-accounting-sync] Production trigger migration verified.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("[payment-accounting-sync] Production trigger migration failed.", error);
  process.exitCode = 1;
} finally {
  await client.end();
}