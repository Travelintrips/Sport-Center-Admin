/** Periodic worker ordering only. Existing eligibility, device command, ACK and
 * read-back gates remain solely in processX904NonmemberDailyAccess.
 */
export async function processPaidVisRecoveryCycle(
  processGrants: () => Promise<void>,
  recoverVis: () => Promise<number>,
): Promise<void> {
  // A stuck recovery query must not delay already verified grants.
  await processGrants();
  let recovered = 0;
  try {
    recovered = await recoverVis();
  } catch (error) {
    console.warn("[gym-vis] recovery query unavailable; paid-access worker already ran",
      error instanceof Error ? error.message : String(error));
  }
  // At most one extra pass. No new payment or direct X904 write here.
  if (recovered > 0) await processGrants();
}
