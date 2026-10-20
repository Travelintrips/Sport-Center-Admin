import { describe, it, expect } from '@jest/globals';
import { inspectX904RawCandidate, x904ReleasePreflight } from './x904RawProofGate';
describe('X904 proof gating', () => {
  it('does not promote raw byte candidates', () => {
    const record = Buffer.alloc(40); record[26] = 1;
    const result = inspectX904RawCandidate(record.toString('hex'), 14330);
    expect(result.candidateMethod).toBe('fingerprint');
    expect(result.evidenceStatus).toBe('unverified');
    expect(result.eligibleForCheckin).toBe(false);
  });
  it('rejects old or unverified events and duplicates', () => {
    const p = { serial: 'TDBD234200545', expectedSerial: 'TDBD234200545', index: 14331, activationFloor: 14330, sourceAuthenticated: true, deviceIdentityAttested: true, methodAttested: true, memberMappingVerified: true, digest: 'a'.repeat(64), alreadyProcessed: false };
    expect(x904ReleasePreflight({ ...p, index: 14330 }).allowed).toBe(false);
    expect(x904ReleasePreflight({ ...p, methodAttested: false }).allowed).toBe(false);
    expect(x904ReleasePreflight({ ...p, alreadyProcessed: true }).allowed).toBe(false);
    expect(x904ReleasePreflight(p).allowed).toBe(true);
  });
});
