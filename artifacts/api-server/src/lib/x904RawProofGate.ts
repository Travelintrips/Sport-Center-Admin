import { createHash } from "node:crypto";

export type X904EvidenceCandidate = Readonly<{
  index: number;
  recordDigest: string;
  candidateMethod: "fingerprint" | "card" | "face" | "unknown";
  candidateStatusByte: number;
  evidenceStatus: "unverified";
  eligibleForCheckin: false;
}>;

/** This is a byte-level observation, NOT verified device semantics. */
export function inspectX904RawCandidate(hex: string, index: number): X904EvidenceCandidate {
  if (!Number.isSafeInteger(index) || index < 0 || !/^[a-f0-9]{80}$/i.test(hex)) {
    throw new Error("INVALID_X904_RECORD");
  }
  const record = Buffer.from(hex, "hex");
  const candidateMethod = ({ 1: "fingerprint", 4: "card", 15: "face" } as const)[record[26] as 1 | 4 | 15] ?? "unknown";
  return {
    index,
    recordDigest: createHash("sha256").update(record).digest("hex"),
    candidateMethod,
    candidateStatusByte: record[31],
    evidenceStatus: "unverified",
    eligibleForCheckin: false,
  };
}

type ReleaseProof = {
  serial: string;
  expectedSerial: string;
  index: number;
  activationFloor: number;
  sourceAuthenticated: boolean;
  deviceIdentityAttested: boolean;
  methodAttested: boolean;
  memberMappingVerified: boolean;
  digest: string;
  alreadyProcessed: boolean;
};

/** Fail-closed preflight; DB transaction must also enforce unique event IDs. */
export function x904ReleasePreflight(p: ReleaseProof): { allowed: boolean; reason: string } {
  if (p.serial !== p.expectedSerial || !p.sourceAuthenticated || !p.deviceIdentityAttested) return { allowed: false, reason: "DEVICE_NOT_ATTESTED" };
  if (!Number.isSafeInteger(p.activationFloor) || !Number.isSafeInteger(p.index) || p.index <= p.activationFloor) return { allowed: false, reason: "HISTORICAL_EVENT" };
  if (!p.methodAttested || !p.memberMappingVerified) return { allowed: false, reason: "EVIDENCE_NOT_VERIFIED" };
  if (!/^[a-f0-9]{64}$/.test(p.digest)) return { allowed: false, reason: "INVALID_DIGEST" };
  if (p.alreadyProcessed) return { allowed: false, reason: "DUPLICATE_EVENT" };
  return { allowed: true, reason: "ELIGIBLE" };
}
