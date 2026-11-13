import { x904BookedGymDayClosed, x904PaidPinNeedsResolution } from "./x904PaidPinVisitWindow";
describe("paid PIN visit after closing", () => {
 const base = { bookingDate:"2026-11-10", identityType:"pin", paymentStatus:"confirmed", activatedAt:null };
 it("requires resolution after 23 WIB and next day", () => {
  expect(x904PaidPinNeedsResolution(base,new Date("2026-11-10T16:06:00Z"))).toBe(true);
  expect(x904PaidPinNeedsResolution(base,new Date("2026-11-11T03:00:00Z"))).toBe(true);
 });
 it("does not falsely flag earlier or future bookings", () => {
  expect(x904PaidPinNeedsResolution(base,new Date("2026-11-10T15:59:59Z"))).toBe(false);
  expect(x904BookedGymDayClosed("2026-11-11",new Date("2026-11-10T16:06:00Z"))).toBe(false);
 });
 it("never flags unpaid, VIS or previously activated PIN", () => {
  const now=new Date("2026-11-10T16:06:00Z");
  expect(x904PaidPinNeedsResolution({...base,paymentStatus:"pending"},now)).toBe(false);
  expect(x904PaidPinNeedsResolution({...base,identityType:"card"},now)).toBe(false);
  expect(x904PaidPinNeedsResolution({...base,activatedAt:now},now)).toBe(false);
 });
 it("rejects invalid booking date", () => {
  expect(x904BookedGymDayClosed(null,new Date("2026-11-10T16:06:00Z"))).toBe(false);
 });
});
