
import { resolveGymEntitlement, canRecordTrustedGymX904Checkin } from "./gymMembershipEntitlement";

const base = {
  today: "2026-10-23",
  membershipStart: "2026-09-01",
  membershipEnd: "2026-09-30",
  membershipStatus: "active",
  paymentSourcesComplete: true,
  payments: [] as { id: number; periodStart: string; periodEnd: string; status: string; amount: number }[],
};

describe("GYM membership payment entitlement", () => {
  it("keeps paid access despite a separate pending renewal", () => {
    const payments = [
      { id: 10, periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "confirmed", amount: 300000 },
      { id: 11, periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "waiting_confirmation", amount: 300000 },
    ];
    expect(resolveGymEntitlement({ ...base, membershipStatus: "expired", payments })).toBe("active");
  });
  it("holds incomplete payment sources for manual review instead of suspending", () => {
    expect(resolveGymEntitlement({ ...base, paymentSourcesComplete: false })).toBe("review_required");
  });
  it("rejects zero-value confirmed payments as proof of active access", () => {
    expect(resolveGymEntitlement({ ...base, payments: [{ id: 12, periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "confirmed", amount: 0 }] })).toBe("suspended");
  });

  it("allows all seven grace days and suspends on day eight", () => {
    const member = { ...base, membershipEnd: "2026-10-23" };
    expect(resolveGymEntitlement({ ...member, today: "2026-10-23" })).toBe("active");
    expect(resolveGymEntitlement({ ...member, today: "2026-10-24" })).toBe("grace_period");
    expect(resolveGymEntitlement({ ...member, today: "2026-10-30" })).toBe("grace_period");
    expect(resolveGymEntitlement({ ...member, today: "2026-10-31" })).toBe("suspended");
  });
  it("does not suspend during grace if payment is pending verification", () => {
    expect(resolveGymEntitlement({ ...base, membershipEnd: "2026-10-20", payments: [{ id: 6, periodStart: "2026-10-21", periodEnd: "2026-11-20", status: "waiting_confirmation", amount: 300000 }] })).toBe("grace_period");
  });
  it("suspends an overdue member without confirmed coverage", () => {
    expect(resolveGymEntitlement(base)).toBe("suspended");
  });
  it("reactivates only on confirmed payment covering today", () => {
    const payments = [{ id: 1, periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "confirmed", amount: 300000 }];
    expect(resolveGymEntitlement({ ...base, payments })).toBe("active");
    expect(resolveGymEntitlement({ ...base, payments: [{ ...payments[0], status: "waiting_confirmation" }] })).toBe("suspended");
  });
  it("does not suspend when payment sources have not been reconciled", () => {
    expect(resolveGymEntitlement({ ...base, paymentSourcesComplete: false })).toBe("review_required");
  });
  it("does not allow expired payments to unlock access", () => {
    expect(resolveGymEntitlement({ ...base, payments: [{ id: 2, periodStart: "2026-09-01", periodEnd: "2026-09-30", status: "confirmed", amount: 300000 }] })).toBe("suspended");
  });
  it("does not allow a pending renewal to override current paid coverage", () => {
    expect(resolveGymEntitlement({ ...base, payments: [
      { id: 3, periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "confirmed", amount: 300000 },
      { id: 4, periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "pending_payment", amount: 300000 },
    ] })).toBe("active");
  });
  it("requires review for malformed payment dates", () => {
    expect(resolveGymEntitlement({ ...base, payments: [{ id: 5, periodStart: "2026-10-40", periodEnd: "2026-10-31", status: "confirmed", amount: 300000 }] })).toBe("review_required");
  });
});

describe("Trusted X904 physical scan check-in during existing membership grace", () => {
  const paid = [{ id: 71, periodStart: "2026-10-03", periodEnd: "2026-11-03", status: "confirmed", amount: 300000 }];
  const shidqi = { today: "2026-11-06", membershipStart: "2026-10-03",
    membershipEnd: "2026-11-03", membershipStatus: "active",
    paymentSourcesComplete: true, payments: paid };
  it("allows the already-paid SHIDQI membership to check in during seven-day grace", () => {
    expect(canRecordTrustedGymX904Checkin(shidqi)).toBe(true);
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, today: "2026-11-10" })).toBe(true);
  });
  it("does not allow a check-in on day eight without renewal", () => {
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, today: "2026-11-11" })).toBe(false);
  });
  it("does not allow pending-only or zero-value membership evidence", () => {
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, payments: [{ ...paid[0], status: "waiting_confirmation" }] })).toBe(false);
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, payments: [{ ...paid[0], amount: 0 }] })).toBe(false);
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, payments: [] })).toBe(false);
  });
  it("does not mistake a paid period for another month for this membership grace", () => {
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, payments: [{ ...paid[0], periodEnd: "2026-10-29" }] })).toBe(false);
  });
  it("does not bypass expired, suspended, cancelled or unverified finance states", () => {
    for (const membershipStatus of ["expired", "suspended", "cancelled", "waiting_confirmation"]) {
      expect(canRecordTrustedGymX904Checkin({ ...shidqi, membershipStatus })).toBe(false);
    }
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, paymentSourcesComplete: false })).toBe(false);
  });
  it("preserves currently paid member access before expiry", () => {
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, today: "2026-10-29" })).toBe(true);
  });
  it("does not let an unconfirmed future renewal override paid grace", () => {
    expect(canRecordTrustedGymX904Checkin({ ...shidqi, payments: [...paid,
      { id: 72, periodStart: "2026-11-04", periodEnd: "2026-12-04", status: "waiting_confirmation", amount: 300000 }] })).toBe(true);
  });
});
