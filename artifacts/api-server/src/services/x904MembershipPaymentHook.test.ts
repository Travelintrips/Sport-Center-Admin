import { hasCanonicalConfirmedMembershipPayments } from "./x904MembershipPaymentHook";

describe("X904 add-on: canonical membership payment guard", () => {
  it("accepts only one booking for every confirmed payment", () => {
    expect(hasCanonicalConfirmedMembershipPayments([11], [{ id: 11, booking_count: 1 }])).toBe(true);
    expect(hasCanonicalConfirmedMembershipPayments([11, 12], [
      { id: 12, booking_count: 1 }, { id: 11, booking_count: 1 },
    ])).toBe(true);
  });
  it("rejects missing, multiple, unrelated or duplicate booking evidence", () => {
    expect(hasCanonicalConfirmedMembershipPayments([], [])).toBe(false);
    expect(hasCanonicalConfirmedMembershipPayments([11], [])).toBe(false);
    expect(hasCanonicalConfirmedMembershipPayments([11], [{ id: 11, booking_count: 0 }])).toBe(false);
    expect(hasCanonicalConfirmedMembershipPayments([11], [{ id: 11, booking_count: 2 }])).toBe(false);
    expect(hasCanonicalConfirmedMembershipPayments([11], [{ id: 12, booking_count: 1 }])).toBe(false);
    expect(hasCanonicalConfirmedMembershipPayments([11, 12], [
      { id: 11, booking_count: 1 }, { id: 11, booking_count: 1 },
    ])).toBe(false);
  });
});
