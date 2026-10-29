import { planX904PaymentTestCommand } from "./x904PaymentCommandGate";

const base = {
  membershipId: 200, pin: "200", uid: 337, name: "TEST SUSPEND X904",
  role: 0, mappingVerified: true, snapshotComplete: true, snapshotFresh: true,
  canonicalConfirmedPayment: true, entitlement: "active" as const,
  currentGroup: 2, eventKey: "a".repeat(64), enabled: true,
};

describe("PIN 200 payment command safety gate", () => {
  test("plans exactly one deterministic activation intent", () => {
    const result = planX904PaymentTestCommand(base);
    expect(result?.commandType).toBe("ACTIVATE_USER");
    expect(result).toEqual(planX904PaymentTestCommand(base));
  });
  test("suspend only for confirmed suspended entitlement and active group", () => {
    expect(planX904PaymentTestCommand({...base, entitlement: "suspended", currentGroup: 1})?.commandType).toBe("SUSPEND_USER");
    expect(planX904PaymentTestCommand({...base, entitlement: "grace_period", currentGroup: 1})).toBeNull();
    expect(planX904PaymentTestCommand({...base, entitlement: "active", currentGroup: 1})).toBeNull();
  });
  test.each([
    {pin: "54"}, {uid: 311}, {name: "PAUL"}, {role: 14},
    {mappingVerified: false}, {snapshotFresh: false}, {snapshotComplete: false},
    {canonicalConfirmedPayment: false}, {enabled: false}, {eventKey: "invalid"}
  ])("refuses unsafe identity or evidence %j", (patch) => {
    expect(planX904PaymentTestCommand({...base, ...patch})).toBeNull();
  });
});
