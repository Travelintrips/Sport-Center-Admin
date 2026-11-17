import { isX904UsageWithinBookingSession as within, isX904GymDayUsage as gymDay } from "./bookingLifecycleRules";

describe("X904 booking check-in evidence: only actual session usage", () => {
  const day = "2026-11-11", start = "21:03", end = "22:03";
  test("PIN 16 historical scans 19:28/19:30 do not prove SC-1773 attendance", () => {
    expect(within(day,start,end,"2026-11-11 19:28:07")).toBe(false);
    expect(within(day,start,end,"2026-11-11 19:30:08")).toBe(false);
  });
  test("scan during booked session qualifies for time matching only", () => {
    expect(within(day,start,end,"2026-11-11 21:03:00")).toBe(true);
    expect(within(day,start,end,"2026-11-11 22:02:59")).toBe(true);
    expect(within(day,start,end,"2026-11-11 22:03:00")).toBe(false);
  });
  test("new shared Gym day can enter after session but never outside 06:00-23:00 WIB",()=>{
    expect(gymDay("2026-11-17","2026-11-17 19:10:00")).toBe(true);
    expect(gymDay("2026-11-17","2026-11-17 06:00:00")).toBe(true);
    expect(gymDay("2026-11-17","2026-11-17 22:59:59")).toBe(true);
    expect(gymDay("2026-11-17","2026-11-17 23:00:00")).toBe(false);
    expect(gymDay("2026-11-17","2026-11-17 05:59:59")).toBe(false);
    expect(gymDay("2026-11-17","2026-11-18 19:10:00")).toBe(false);
    expect(gymDay("2026-11-17","2026-11-17 24:00:00")).toBe(false);
    // Historical court/session evidence is intentionally unchanged.
    expect(within("2026-11-17","17:27","18:27","2026-11-17 19:10:00")).toBe(false);
  });
  test("midnight-crossing sessions and malformed timestamps fail safely", () => {
    expect(within(day,"23:00","00:00","2026-11-12 00:00:00")).toBe(false);
    expect(within(day,"23:00","00:00","2026-11-11 23:30:00")).toBe(true);
    expect(within(day,start,end,"11/11/2026 21:30")).toBe(false);
  });
});
