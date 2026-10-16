/**
 * Explicitly non-authoritative LAN candidate. A timestamp cannot prove a
 * biometric verification or the direction of travel. Never pass this result
 * to the official trusted-event ingress or the booking/check-in processor.
 */
export type X904LanCandidate = {
  status: 0 | null;
  verify: 1;
  inferred: true;
  eligibleForOfficialCheckin: false;
  evidence: "time_window_assumption_not_hardware_evidence";
};
export function inferX904LanCandidate(
  localDateTime: string,
  membershipVerifiedActive: boolean,
  gymHours: { start: number; end: number },
): X904LanCandidate | null {
  if (!membershipVerifiedActive || !/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(localDateTime)) return null;
  const h = Number(localDateTime.slice(11,13));
  if (!Number.isInteger(h) || !Number.isInteger(gymHours.start) || !Number.isInteger(gymHours.end) ||
    gymHours.start < 0 || gymHours.end > 24 || gymHours.start >= gymHours.end) return null;
  return {status: h >= gymHours.start && h < gymHours.end ? 0 : null,verify:1,inferred:true,
    eligibleForOfficialCheckin:false,evidence:"time_window_assumption_not_hardware_evidence"};
}
