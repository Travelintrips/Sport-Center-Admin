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

const connectionString = rawConnectionString.replace(
  "pooler.supabase.com:6543",
  "pooler.supabase.com:5432",
);
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