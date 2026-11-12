/** A punch state is not a door unlock status.
 * ZKTeco attendance records legitimately use 255 ("undefined" punch).
 * Only allow these values AFTER authenticated, signed, same-event VMSC proof;
 * this helper does NOT authorize a booking, member or door by itself.
 */
export function isX904SupportedAttestedPunchState(
  state: unknown,
): state is 0 | 255 {
  return state === 0 || state === 255;
}
