import { isX904SupportedAttestedPunchState } from "./x904PunchState";

describe("new X904 VMSC attestation punch-state validation", () => {
  test("preserves previously accepted punch state zero", () => {
    expect(isX904SupportedAttestedPunchState(0)).toBe(true);
  });
  test("recognizes the official undefined punch state 255", () => {
    expect(isX904SupportedAttestedPunchState(255)).toBe(true);
  });
  test("does not accept unrelated punch codes, unknown, or string coercions", () => {
    for (const value of [1,2,3,4,15,254,256,-1,NaN,null,undefined,"0","255",true,{}])
      expect(isX904SupportedAttestedPunchState(value)).toBe(false);
  });
});
