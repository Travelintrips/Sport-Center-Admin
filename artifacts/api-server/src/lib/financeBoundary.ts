export type SportCenterFinanceMode = "legacy" | "shadow" | "central";

/**
 * The production-safe default keeps the existing downstream processor active.
 * Switching to "central" is an explicit cutover action for a later phase.
 */
export function getSportCenterFinanceMode(): SportCenterFinanceMode {
  const configured = String(process.env.SPORT_CENTER_FINANCE_MODE ?? "legacy")
    .trim()
    .toLowerCase();
  if (configured === "shadow" || configured === "central") return configured;
  return "legacy";
}

export function shouldRunLegacyFinanceWrites(): boolean {
  return getSportCenterFinanceMode() !== "central";
}

export function isCentralFinanceMode(): boolean {
  return getSportCenterFinanceMode() === "central";
}