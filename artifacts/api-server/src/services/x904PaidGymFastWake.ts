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
  if (process.env.GYM_X904_PAID_GYM_FAST_WAKE_ENABLED !== "true" ||
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
      // At most one follow-up cycle to avoid a noisy request storm.
      await run();
      if (rerunRequested) {
        rerunRequested = false;
        await run();
      }
    } catch (error) {
      console.error("[x904-paid-gym-fast-wake] worker wake failed; 60s scheduler remains fallback",
        error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
      rerunRequested = false;
    }
  });
  return true;
}
