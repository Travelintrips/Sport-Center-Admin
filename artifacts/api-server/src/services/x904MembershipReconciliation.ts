import { createHash } from "node:crypto";
import { resolveGymEntitlement, type GymPaymentPeriod, type GymEntitlement } from "./gymMembershipEntitlement";

/**
 * Read-only reconciliation planner. This function deliberately never issues an
 * X904 command. Only a separately approved worker may consume a plan.
 *
 * A name match (even unique) is not identity verification. An identity must be
 * explicitly verified, with a PIN and device UID read back from a fresh SDK
 * snapshot. Unverified/ambiguous identities are always held for review.
 */
export type X904VerifiedIdentity = {
  membershipId: number;
  userPin: string;
  deviceUid: number;
  deviceSerial: string;
  status: "verified" | "review_required";
  snapshotFresh: boolean;
  matchesSdk: boolean;
  uniqueMembership: boolean;
};

export type ReconciliationInput = {
  membershipId: number;
  membershipStart: string;
  membershipEnd: string;
  membershipStatus: string;
  today: string;
  payments: GymPaymentPeriod[];
  paymentSourcesComplete: boolean;
  identity: X904VerifiedIdentity | null;
};

export type X904MembershipPlan = {
  eventKey: string;
  entitlement: GymEntitlement;
  state: "ready" | "review_required";
  userPin: string | null;
  deviceUid: number | null;
  reason: string;
  /** Always false until a separately tested and approved access worker exists. */
  executeDeviceCommand: false;
};

export function planX904MembershipReconciliation(input: ReconciliationInput): X904MembershipPlan {
  const entitlement = resolveGymEntitlement(input);
  const evidence = input.payments.map(p => ({
    id: String(p.id), start: p.periodStart, end: p.periodEnd,
    status: p.status, amount: p.amount,
  })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // A deterministic operation identity makes repeated callbacks yield the same
  // key, regardless of payment retrieval order. Database consumers MUST also
  // enforce a unique constraint on this key.
  const eventKey = createHash("sha256").update(JSON.stringify({
    version: 1, membershipId: input.membershipId, date: input.today,
    membershipStart: input.membershipStart, membershipEnd: input.membershipEnd,
    membershipStatus: input.membershipStatus, entitlement, evidence,
    // A later verified mapping is a distinct review receipt, not a duplicate
    // of the earlier unverified candidate. Never include snapshot timestamps.
    identity: input.identity?.status === "verified" ? {
      membershipId: input.identity.membershipId,
      deviceSerial: input.identity.deviceSerial,
      pin: input.identity.userPin,
      uid: input.identity.deviceUid,
      valid: input.identity.snapshotFresh && input.identity.matchesSdk && input.identity.uniqueMembership,
    } : null,
  })).digest("hex");
  const identity = input.identity;
  const validIdentity = identity !== null &&
    identity.status === "verified" &&
    identity.membershipId === input.membershipId &&
    identity.snapshotFresh && identity.matchesSdk && identity.uniqueMembership &&
    new RegExp("^[0-9]{1,10}$").test(identity.userPin) &&
    Number.isSafeInteger(identity.deviceUid) &&
    identity.deviceUid > 0 && identity.deviceUid < 65535 &&
    identity.deviceSerial.length > 0;
  if (entitlement === "review_required") {
    return { eventKey, entitlement, state: "review_required", userPin: null,
      deviceUid: null, reason: "PAYMENT_OR_PERIOD_REVIEW_REQUIRED", executeDeviceCommand: false };
  }
  if (!validIdentity) {
    return { eventKey, entitlement, state: "review_required", userPin: null,
      deviceUid: null, reason: "IDENTITY_NOT_VERIFIED", executeDeviceCommand: false };
  }
  return { eventKey, entitlement, state: "ready", userPin: identity.userPin,
    deviceUid: identity.deviceUid, reason: "SAFE_FOR_MANUAL_REVIEW_ONLY", executeDeviceCommand: false };
}
