import { describe, expect, it } from "@jest/globals";
import { evaluateBookingCancellation } from "../bookingCancellationPolicy";

describe("universal booking cancellation policy", () => {
  const base = {
    bookingStatuses: ["pending_payment"],
    paymentStatuses: [],
    membershipPaymentStatuses: [],
    invoiceNumbers: [],
    groupStatus: "pending",
  };

  it("allows unpaid single and group bookings with no payment or invoice", () => {
    expect(evaluateBookingCancellation(base)).toEqual({ allowed: true });
    expect(evaluateBookingCancellation({ ...base, bookingStatuses: ["pending_payment", "waiting_admin_approval"] }))
      .toEqual({ allowed: true });
  });

  it("blocks confirmed payment and paid groups for the refund flow", () => {
    expect(evaluateBookingCancellation({ ...base, paymentStatuses: ["confirmed"] }))
      .toEqual({ allowed: false, kind: "payment_confirmed" });
    expect(evaluateBookingCancellation({ ...base, groupStatus: "paid" }))
      .toEqual({ allowed: false, kind: "payment_confirmed" });
  });

  it("blocks pending proof until payment verification is resolved", () => {
    expect(evaluateBookingCancellation({ ...base, paymentStatuses: ["pending"] }))
      .toEqual({ allowed: false, kind: "payment_pending" });
  });

  it("blocks active membership payment and company invoice links", () => {
    expect(evaluateBookingCancellation({ ...base, membershipPaymentStatuses: ["waiting_confirmation"] }))
      .toEqual({ allowed: false, kind: "membership_payment" });
    expect(evaluateBookingCancellation({ ...base, invoiceNumbers: ["INV-202611-0001"] }))
      .toEqual({ allowed: false, kind: "company_invoice" });
  });

  it("blocks operationally final statuses", () => {
    for (const status of ["completed", "refunded", "expired", "rejected", "paid", "confirmed", "waiting_confirmation"]) {
      expect(evaluateBookingCancellation({ ...base, bookingStatuses: [status] }))
        .toEqual({ allowed: false, kind: "terminal_status" });
    }
  });
});
