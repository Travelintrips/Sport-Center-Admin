import { createHash } from "node:crypto";
import type { GymEntitlement } from "./gymMembershipEntitlement";

/**
 * Payment-to-command decision only. No database writes and no device access.
 * Hard limited to isolated TEST SUSPEND X904 (PIN 200 / UID 337).
 */
export function planX904PaymentTestCommand(input: {
  membershipId: number;
  pin: string;
  uid: number;
  name: string;
  role: number;
  mappingVerified: boolean;
  snapshotComplete: boolean;
  snapshotFresh: boolean;
  canonicalConfirmedPayment: boolean;
  entitlement: GymEntitlement;
  currentGroup: number;
  eventKey: string;
  enabled: boolean;
}): { commandType: "ACTIVATE_USER" | "SUSPEND_USER"; idempotencyKey: string } | null {
  if (!input.enabled || input.pin !== "200" || input.uid !== 337 ||
      input.name !== "TEST SUSPEND X904" || input.role !== 0 ||
      !input.mappingVerified || !input.snapshotComplete || !input.snapshotFresh ||
      !input.canonicalConfirmedPayment || !Number.isSafeInteger(input.membershipId) ||
      input.membershipId <= 0 || !/^[a-f0-9]{64}$/.test(input.eventKey)) return null;

  const commandType = input.entitlement === "active" && input.currentGroup === 2
    ? "ACTIVATE_USER" : input.entitlement === "suspended" && input.currentGroup === 1
      ? "SUSPEND_USER" : null;
  if (!commandType) return null;
  const idempotencyKey = "x904pay_" + createHash("sha256")
    .update([input.eventKey, commandType, input.pin, input.uid].join(":"))
    .digest("hex").slice(0, 44);
  return {commandType, idempotencyKey};
}
