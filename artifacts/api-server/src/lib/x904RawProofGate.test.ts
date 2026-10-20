import { strict as assert } from "node:assert";
import { test } from "node:test";
import { inspectX904RawCandidate, x904ReleasePreflight } from "./x904RawProofGate";

test("X904 byte candidate is never treated as verified proof", () => {
  const record = Buffer.alloc(40);
  record[26] = 1;
  record[31] = 0;
  const event = inspectX904RawCandidate(record.toString("hex"), 14330);
  assert.equal(event.candidateMethod, "fingerprint");
  assert.equal(event.evidenceStatus, "unverified");
  assert.equal(event.eligibleForCheckin, false);
  assert.throws(() => inspectX904RawCandidate("00", 1), /INVALID_X904_RECORD/);
});

test("X904 release blocks history, spoofing, insufficient proof and duplicates", () => {
  const base = { serial: "TDBD234200545", expectedSerial: "TDBD234200545", index: 14331, activationFloor: 14330, sourceAuthenticated: true, deviceIdentityAttested: true, methodAttested: true, memberMappingVerified: true, digest: "a".repeat(64), alreadyProcessed: false };
  assert.equal(x904ReleasePreflight({ ...base, index: 14330 }).reason, "HISTORICAL_EVENT");
  assert.equal(x904ReleasePreflight({ ...base, sourceAuthenticated: false }).reason, "DEVICE_NOT_ATTESTED");
  assert.equal(x904ReleasePreflight({ ...base, methodAttested: false }).reason, "EVIDENCE_NOT_VERIFIED");
  assert.equal(x904ReleasePreflight({ ...base, alreadyProcessed: true }).reason, "DUPLICATE_EVENT");
  assert.equal(x904ReleasePreflight(base).allowed, true);
});
