/** Pure deterministic selection under a transaction-wide DB advisory lock. */
export function chooseThreeDigitX904Pin(
  mode: "manual" | "generate",
  manualPin: string,
  occupied: ReadonlySet<string>,
  start: number,
): string | null {
  if (mode === "manual") {
    return /^[1-9][0-9]{2}$/.test(manualPin) &&
      manualPin !== "200" && manualPin !== "500" && !occupied.has(manualPin)
      ? manualPin : null;
  }
  if (!Number.isInteger(start) || start < 0 || start > 899) return null;
  for (let i = 0; i < 900; i++) {
    const candidate = String(100 + ((start + i) % 900));
    if (candidate !== "200" && candidate !== "500" && !occupied.has(candidate))
      return candidate;
  }
  return null;
}
