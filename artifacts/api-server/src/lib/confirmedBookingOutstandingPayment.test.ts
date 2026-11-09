import { canRecordConfirmedBookingOutstandingPayment as canRecord } from "./confirmedBookingOutstandingPayment";

const base = {
  bookingStatus: "confirmed", confirmedAmount: 100000,
  billedAmount: 200000, actorRole: "admin", hasUnconfirmedPayment: false,
};

describe("SC-1741 confirmed booking receives remaining balance without a new booking", () => {
  test("authorized admin can record exactly one outstanding payment", () => {
    expect(canRecord(base)).toBe(true);
    expect(canRecord({ ...base, actorRole: "staff" })).toBe(true);
  });
  test("anonymous and customer cannot reopen confirmed booking", () => {
    expect(canRecord({ ...base, actorRole: null })).toBe(false);
    expect(canRecord({ ...base, actorRole: "customer" })).toBe(false);
  });
  test("fully paid and overpaid bookings reject further submissions", () => {
    expect(canRecord({ ...base, confirmedAmount: 200000 })).toBe(false);
    expect(canRecord({ ...base, confirmedAmount: 210000 })).toBe(false);
  });
  test("pending settlement blocks another outstanding payment", () => {
    expect(canRecord({ ...base, hasUnconfirmedPayment: true })).toBe(false);
  });
  test("terminal statuses cannot record outstanding payments", () => {
    for (const bookingStatus of ["cancelled", "refunded", "rejected", "expired", "completed", "waiting_confirmation"]) {
      expect(canRecord({ ...base, bookingStatus })).toBe(false);
    }
  });
  test("invalid totals reject requests", () => {
    expect(canRecord({ ...base, billedAmount: NaN })).toBe(false);
    expect(canRecord({ ...base, confirmedAmount: Infinity })).toBe(false);
  });
});
