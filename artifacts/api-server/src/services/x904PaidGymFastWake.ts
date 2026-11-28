import { processX904NonmemberDailyAccess } from "./x904NonmemberDailyAccessWorker";
import { recoverUnallocatedPaidGymVis } from "./x904GymVisitorCardReservations";

/**
 * A post-commit wake-up for an already confirmed Gym guest payment.
 * Existing X904 worker still owns eligibility, UID, membership, RLS and command
 * idempotency. This only avoids waiting for the next 60-second timer tick.
 * It never writes to the device, marks a grant active, or bypasses read-back.
 */
let running = false;
let rerunRequested = false;

export function wakeX904PaidGymAfterConfirmation(
  eligibleCommittedPayment: boolean,
  run: () => Promise<void> = async () => {
    await recoverUnallocatedPaidGymVis().catch(error =>
      console.warn("[gym-vis] fast recovery failed; worker fallback remains",
        error instanceof Error ? error.message : String(error)));
    await processX904NonmemberDailyAccess();
  },
): boolean {
  // Enable the already-tested post-commit wake by default for eligible paid Gym
  // confirmations; explicit false remains an immediate operational kill switch.
  // The normal 60-second worker and all physical ACK/read-back checks are intact.
  if (process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED === "false" ||
      !eligibleCommittedPayment) return false;
  if (running) {
    // Coalesce concurrent confirmations. Avoid losing a second paid guest when
    // the first worker cycle has already loaded its pending-grant candidates.
    rerunRequested = true;
    return true;
  }
  running = true;
  void Promise.resolve().then(async () => {
    try {
      // A failed first cycle must not drop a second confirmed payment that
      // arrived while it was running. Each cycle stays inside the existing
      // guarded worker; no direct grant or X904 command writes occur here.
      try {
        await run();
      } catch (error) {
        console.error("[x904-paid-gym-fast-wake] worker wake failed; 60s scheduler remains fallback",
          error instanceof Error ? error.message : String(error));
      }
      while (rerunRequested) {
        rerunRequested = false;
        try {
          await run();
        } catch (error) {
          console.error("[x904-paid-gym-fast-wake] coalesced wake failed; 60s scheduler remains fallback",
            error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      running = false;
      rerunRequested = false;
    }
  });
  return true;
}
