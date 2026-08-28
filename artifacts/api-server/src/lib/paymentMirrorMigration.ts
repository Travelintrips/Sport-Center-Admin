import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import manualProviderMirrorMigration from "../../../../scripts/patch_manual_provider_mirror_function.sql";
import paymentMetadataResolverMigration from "../../../../scripts/patch_resolve_function.sql";
import publicPaymentEntryMetadataSyncMigration from "../../../../scripts/patch_public_payment_entry_metadata_sync.sql";
import internalPaymentJournalMetadataSyncMigration from "../../../../scripts/patch_internal_payment_journal_metadata_sync.sql";

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
          throw new Error("PAYMENT_MIRROR_MIGRATION_NOT_PROVISIONED");
        }
      })
    : db.transaction(async (tx) => {
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