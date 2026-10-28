import { planX904MembershipReconciliation } from "./x904MembershipReconciliation";

const base = {
  membershipId: 65, membershipStart: "2026-10-06",
  membershipEnd: "2026-11-06", membershipStatus: "active",
  today: "2026-10-28", paymentSourcesComplete: true,
  payments: [{ id: 101, periodStart: "2026-10-06", periodEnd: "2026-11-06",
    status: "confirmed", amount: 300000 }],
  identity: { membershipId: 65, userPin: "153", deviceUid: 153,
    deviceSerial: "TDBD234200545", status: "verified" as const,
    snapshotFresh: true, matchesSdk: true, uniqueMembership: true },
};

describe("X904 read-only payment reconciliation", () => {
  it("emits a stable key for repeated and reordered payment events", () => {
    const second = { id: 100, periodStart: "2026-09-06", periodEnd: "2026-10-06",
      status: "confirmed", amount: 300000 };
    const a = planX904MembershipReconciliation({ ...base, payments: [...base.payments, second] });
    const b = planX904MembershipReconciliation({ ...base, payments: [second, ...base.payments] });
    expect(a.eventKey).toBe(b.eventKey);
    expect(a.entitlement).toBe("active");
    expect(a.state).toBe("ready");
    expect(a.executeDeviceCommand).toBe(false);
  });
  it("holds a name-only candidate and never opens access", () => {
    const result = planX904MembershipReconciliation({
      ...base, identity: { ...base.identity, status: "review_required" },
    });
    expect(result.state).toBe("review_required");
    expect(result.userPin).toBeNull();
    expect(result.executeDeviceCommand).toBe(false);
  });
  it("holds duplicate matching machine identities", () => {
    expect(planX904MembershipReconciliation({
      ...base, identity: { ...base.identity, uniqueMembership: false },
    }).reason).toBe("IDENTITY_NOT_VERIFIED");
  });
  it("holds stale machine evidence and mismatched membership IDs", () => {
    expect(planX904MembershipReconciliation({
      ...base, identity: { ...base.identity, snapshotFresh: false },
    }).state).toBe("review_required");
    expect(planX904MembershipReconciliation({
      ...base, identity: { ...base.identity, membershipId: 6 },
    }).state).toBe("review_required");
  });
  it("does not grant paid entitlement for unconfirmed payments", () => {
    const result = planX904MembershipReconciliation({
      ...base, payments: base.payments.map(p => ({ ...p, status: "waiting_confirmation" })),
      membershipEnd: "2026-10-01",
    });
    expect(result.entitlement).toBe("suspended");
    expect(result.executeDeviceCommand).toBe(false);
  });
  it("holds incomplete payment sources", () => {
    const result = planX904MembershipReconciliation({ ...base, paymentSourcesComplete: false });
    expect(result.state).toBe("review_required");
    expect(result.executeDeviceCommand).toBe(false);
  });
});
