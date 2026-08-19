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

  startupPromise = db.transaction(async (tx) => {
    // The resolver may be reached by older/direct database triggers before the
    // mirror projection runs. Install its manual-payment branch first, then
    // install and verify the mirror trigger that depends on it.
    await tx.execute(sql.raw(paymentMetadataResolverMigration));
    await tx.execute(sql.raw(manualProviderMirrorMigration));
  })
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