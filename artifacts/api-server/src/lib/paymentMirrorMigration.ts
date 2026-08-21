import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import manualProviderMirrorMigration from "../../../../scripts/patch_manual_provider_mirror_function.sql";
import paymentMetadataResolverMigration from "../../../../scripts/patch_resolve_function.sql";

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
          ) AS trigger_exists
      `)).then((result) => {
        const row = result.rows[0] as
          | { resolver_exists?: boolean; trigger_exists?: boolean }
          | undefined;
        if (!row?.resolver_exists || !row.trigger_exists) {
          throw new Error("PAYMENT_MIRROR_MIGRATION_NOT_PROVISIONED");
        }
      })
    : db.transaction(async (tx) => {
        // The resolver may be reached by older/direct database triggers before
        // the mirror projection runs. Install its manual-payment branch first,
        // then install and verify the mirror trigger that depends on it.
        await tx.execute(sql.raw(paymentMetadataResolverMigration));
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