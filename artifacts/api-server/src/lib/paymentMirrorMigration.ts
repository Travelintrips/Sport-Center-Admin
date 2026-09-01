import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import manualProviderMirrorMigration from "../../../../scripts/patch_manual_provider_mirror_function.sql";
import paymentMetadataResolverMigration from "../../../../scripts/patch_resolve_function.sql";
import publicPaymentEntryMetadataSyncMigration from "../../../../scripts/patch_public_payment_entry_metadata_sync.sql";
import internalPaymentJournalMetadataSyncMigration from "../../../../scripts/patch_internal_payment_journal_metadata_sync.sql";
import postedAccountingMetadataCorrectionMigration from "../../../../scripts/patch_posted_accounting_metadata_correction.sql";

type MigrationState =
  | { status: "pending" }
  | { status: "ready" }
  | { status: "failed"; error: unknown };

let state: MigrationState = { status: "pending" };
let startupPromise: Promise<void> | null = null;

/**
 * This migration guards a financial confirmation path. It is intentionally
 * separate from the best-effort legacy startup migration queue: accepting a
 * confirmation with an older trigger is less safe than returning a retryable
 * service-unavailable response until the trigger has been verified.
 */
export function startPaymentMirrorMigration(): Promise<void> {
  if (startupPromise) return startupPromise;

  startupPromise = (process.env.NODE_ENV === "production"
    ? db.execute(sql.raw(`
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
          ) AS trigger_exists,
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
          ) AS mirror_supports_manual_metadata_correction
          ,
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
          ) AS public_entry_sync_trigger_exists
          ,
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
          ) AS internal_journal_sync_trigger_exists
      `)).then((result) => {
        const row = result.rows[0] as
          | {
              resolver_exists?: boolean;
              resolver_supports_manual_provider?: boolean;
              trigger_exists?: boolean;
              mirror_supports_manual_metadata_correction?: boolean;
              public_entry_sync_trigger_exists?: boolean;
              internal_journal_sync_trigger_exists?: boolean;
            }
          | undefined;
        if (
          !row?.resolver_exists ||
          !row.resolver_supports_manual_provider ||
          !row.trigger_exists ||
          !row.mirror_supports_manual_metadata_correction ||
          !row.public_entry_sync_trigger_exists ||
          !row.internal_journal_sync_trigger_exists
        ) {
          const markerState = {
            resolverExists: Boolean(row?.resolver_exists),
            resolverSupportsManualProvider: Boolean(row?.resolver_supports_manual_provider),
            triggerExists: Boolean(row?.trigger_exists),
            mirrorSupportsManualMetadataCorrection: Boolean(
              row?.mirror_supports_manual_metadata_correction,
            ),
            publicEntrySyncTriggerExists: Boolean(row?.public_entry_sync_trigger_exists),
            internalJournalSyncTriggerExists: Boolean(
              row?.internal_journal_sync_trigger_exists,
            ),
          };
          throw new Error(
            `PAYMENT_MIRROR_MIGRATION_NOT_PROVISIONED ${JSON.stringify(markerState)}`,
          );
        }
      })
    : db.transaction(async (tx) => {
         // CREATE OR REPLACE FUNCTION updates PostgreSQL system catalogs. A
         // second dev workflow restart can otherwise race the first one and
         // fail with "tuple concurrently updated".
         await tx.execute(sql`
           SELECT pg_advisory_xact_lock(918274615)
         `);
         // Existing posted journals need the explicit metadata-only guard
         // installed before the one-time snapshot backfill runs.
         await tx.execute(sql.raw(postedAccountingMetadataCorrectionMigration));
         await tx.execute(sql.raw(
           "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
         ));
         // The trigger below projects payment settlement metadata into the
         // internal accounting journal. Ensure the target columns exist before
         // replacing the trigger function, including on an older database.
         await tx.execute(sql`
           ALTER TABLE sport_center.accounting_journals
             ADD COLUMN IF NOT EXISTS provider_name text,
             ADD COLUMN IF NOT EXISTS provider_id text,
             ADD COLUMN IF NOT EXISTS expected_settlement_date text,
             ADD COLUMN IF NOT EXISTS settlement_status text,
             ADD COLUMN IF NOT EXISTS mdr_rate numeric(8,5),
             ADD COLUMN IF NOT EXISTS mdr_amount numeric(14,2)
         `);
         await tx.execute(sql`
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
        // The resolver may be reached by older/direct database triggers before
        // the mirror projection runs. Install its manual-payment branch first,
        // then install the public-entry sync and mirror triggers that depend
        // on those canonical metadata values.
        await tx.execute(sql.raw(paymentMetadataResolverMigration));
        await tx.execute(sql.raw(internalPaymentJournalMetadataSyncMigration));
        await tx.execute(sql.raw(publicPaymentEntryMetadataSyncMigration));
        await tx.execute(sql.raw(manualProviderMirrorMigration));
      }))
    .then(() => {
      state = { status: "ready" };
    })
    .catch((error) => {
      state = { status: "failed", error };
      throw error;
    });

  return startupPromise;
}

export function assertPaymentMirrorMigrationReady(): void {
  if (state.status === "ready") return;
  if (state.status === "failed") {
    throw new Error("PAYMENT_MIRROR_MIGRATION_FAILED");
  }
  throw new Error("PAYMENT_MIRROR_MIGRATION_PENDING");
}