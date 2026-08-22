import { describe, expect, it } from "@jest/globals";
import {
  CONFIRMABLE_BOOKING_STATUSES,
  hasBookingSessionEnded,
  hasBookingSessionStarted,
  isBookingConfirmableStatus,
} from "./bookingLifecycleRules";

describe("booking lifecycle guard contracts", () => {
  it("only permits payment confirmation from active payment states", () => {
    expect(CONFIRMABLE_BOOKING_STATUSES).toEqual([
      "pending_payment",
      "waiting_confirmation",
      "waiting_admin_approval",
      "paid",
    ]);
    expect(isBookingConfirmableStatus("waiting_confirmation")).toBe(true);
    expect(isBookingConfirmableStatus("confirmed")).toBe(false);
    expect(isBookingConfirmableStatus("completed")).toBe(false);
    expect(isBookingConfirmableStatus("cancelled")).toBe(false);
  });

  it("does not consider a session complete before its end", () => {
    const beforeEnd = new Date("2026-08-22T10:59:00+07:00");
    const atEnd = new Date("2026-08-22T11:00:00+07:00");
    expect(hasBookingSessionEnded("2026-08-22", "11:00", beforeEnd)).toBe(false);
    expect(hasBookingSessionEnded("2026-08-22", "11:00", atEnd)).toBe(true);
  });

  it("treats midnight close as the end of the booking day", () => {
    expect(
      hasBookingSessionEnded(
        "2026-08-22",
        "00:00",
        new Date("2026-08-22T23:59:59+07:00"),
      ),
    ).toBe(false);
    expect(
      hasBookingSessionEnded(
        "2026-08-22",
        "00:00",
        new Date("2026-08-23T00:00:00+07:00"),
      ),
    ).toBe(true);
  });

  it("does not allow check-in before the scheduled start", () => {
    expect(
      hasBookingSessionStarted(
        "2026-08-22",
        "15:00",
        new Date("2026-08-22T14:59:00+07:00"),
      ),
    ).toBe(false);
    expect(
      hasBookingSessionStarted(
        "2026-08-22",
        "15:00",
        new Date("2026-08-22T15:00:00+07:00"),
      ),
    ).toBe(true);
  });
});