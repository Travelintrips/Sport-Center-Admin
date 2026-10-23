import { describe, expect, it } from "vitest";
import { resolveGymEntitlement } from "./gymMembershipEntitlement";

const base = {
  today: "2026-10-23",
  membershipStart: "2026-09-01",
  membershipEnd: "2026-09-30",
  membershipStatus: "active",
  paymentSourcesComplete: true,
  payments: [] as { id: number; periodStart: string; periodEnd: string; status: string; amount: number }[],
};

describe("GYM membership payment entitlement", () => {
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
