import { describe, expect, it } from "@jest/globals";
import {
  shouldRecoverSuccessfulPaylabsTransaction,
  shouldRepairSuccessfulPaylabsBooking,
  shouldSkipPaylabsInquiry,
} from "./paylabsRecovery.js";

describe("Paylabs stale-success recovery", () => {
  it("repairs a local SUCCESS transaction when the booking is still pending", () => {
    expect(shouldRepairSuccessfulPaylabsBooking("SUCCESS", "pending_payment")).toBe(true);
    expect(shouldRepairSuccessfulPaylabsBooking("success", "waiting_confirmation")).toBe(true);
  });

  it("does not skip recovery for a local SUCCESS transaction", () => {
    expect(shouldSkipPaylabsInquiry("SUCCESS")).toBe(false);
  });

  it("does not repair confirmed or terminal bookings", () => {
    expect(shouldRepairSuccessfulPaylabsBooking("SUCCESS", "confirmed")).toBe(false);
    expect(shouldRepairSuccessfulPaylabsBooking("SUCCESS", "cancelled")).toBe(false);
    expect(shouldRepairSuccessfulPaylabsBooking("SUCCESS", "refunded")).toBe(false);
  });

  it("still checks the canonical payment mirror for an already confirmed booking", () => {
    expect(shouldRecoverSuccessfulPaylabsTransaction("SUCCESS", "confirmed")).toBe(true);
    expect(shouldRecoverSuccessfulPaylabsTransaction("SUCCESS", "completed")).toBe(true);
  });

  it("still skips provider inquiry for failed terminal states", () => {
    expect(shouldSkipPaylabsInquiry("FAILED")).toBe(true);
    expect(shouldSkipPaylabsInquiry("CANCELLED")).toBe(true);
    expect(shouldSkipPaylabsInquiry("EXPIRED")).toBe(true);
    expect(shouldSkipPaylabsInquiry("PENDING")).toBe(false);
  });
});
