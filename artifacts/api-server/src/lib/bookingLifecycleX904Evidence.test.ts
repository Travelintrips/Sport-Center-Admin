import { isX904UsageWithinBookingSession as within } from "./bookingLifecycleRules";

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
  test("midnight-crossing sessions and malformed timestamps fail safely", () => {
    expect(within(day,"23:00","00:00","2026-11-12 00:00:00")).toBe(false);
    expect(within(day,"23:00","00:00","2026-11-11 23:30:00")).toBe(true);
    expect(within(day,start,end,"11/11/2026 21:30")).toBe(false);
  });
});
