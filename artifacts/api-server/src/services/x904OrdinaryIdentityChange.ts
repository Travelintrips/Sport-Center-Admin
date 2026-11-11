type X904SnapshotUser = {pin?:unknown;name?:unknown;role?:unknown;group?:unknown;enabled?:unknown};
/** Detect role-0 identity replacement without inheriting old PIN authorization.
 * A name-only change is a REVIEW event, not proof of a new person: never
 * issue a device write or auto-verify based on the display name alone.
 */
export function classifyX904OrdinaryIdentityChange(
  previous: X904SnapshotUser | null, current: X904SnapshotUser,
): "new" | "replacement_review" | "unchanged" | "excluded" {
  const pin = String(current.pin ?? "");
  const name = String(current.name ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID");
  if (!/^[0-9]{1,8}$/.test(pin) || Number(current.role) !== 0 ||
      (["12","79","237"].includes(pin)) || current.enabled !== true || name.length < 2)
    return "excluded";
  if (!previous) return "new";
  if (String(previous.pin ?? "") !== pin || Number(previous.role) !== 0)
    return "excluded";
  const oldName = String(previous.name ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID");
  return oldName === name ? "unchanged" : "replacement_review";
}

/** Audit every adjacent observation; do not miss a PIN first enrolled mid-window
 * and renamed again before the last snapshot. Only role-0 valid identities.
 * A different identity produces a review event, never device commands.
 */
export function findX904OrdinaryIdentityReplacements(
  snapshots: ReadonlyArray<ReadonlyArray<X904SnapshotUser>>,
): string[] {
  const changed = new Set<string>();
  for (let i = 1; i < snapshots.length; i++) {
    const prior = new Map(snapshots[i - 1].map(u => [String(u.pin ?? ""), u]));
    for (const current of snapshots[i]) {
      const pin = String(current.pin ?? "");
      const previous = prior.get(pin);
      if (previous && classifyX904OrdinaryIdentityChange(previous, current) === "replacement_review")
        changed.add(pin);
    }
  }
  return [...changed].sort((a,b) => a.localeCompare(b, "en", { numeric: true }));
}
