import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("No-login PIN exclusivity with stale identity reviews", () => {
  const wa = readFileSync(join(process.cwd(),"src/routes/whatsapp.ts"),"utf8");
  const booking = readFileSync(join(process.cwd(),"src/routes/bookings.ts"),"utf8");
  const start = wa.indexOf("const busy = await tx.execute");
  const bookingGuard = wa.slice(start,wa.indexOf("if (busy.rows.length)",start));
  const staffStart = booking.indexOf("const activeElsewhere = await tx.execute");
  const staffGuard = booking.slice(staffStart,booking.indexOf("if (activeElsewhere.rows.length)",staffStart));

  it("anonymous PIN linking locks the PIN but excludes old/cancelled review bookings", () => {
    expect(bookingGuard).toContain("JOIN sport_center.sport_bookings prior");
    expect(bookingGuard).toContain("a.access_state IN ('pending','active')");
    expect(bookingGuard).toContain("a.access_state='review_required'");
    expect(bookingGuard).toContain("prior.booking_date=");
    expect(bookingGuard).toContain("prior.status NOT IN ('cancelled','expired','rejected','refunded','completed')");
  });
  it("staff approval follows same stale-review rule without weakening active protection", () => {
    expect(staffGuard).toContain("a.access_state IN ('pending','active')");
    expect(staffGuard).toContain("a.access_state='review_required'");
    expect(staffGuard).toContain("prior.booking_date=");
    expect(staffGuard).toContain("prior.status NOT IN ('cancelled','expired','rejected','refunded','completed')");
  });
});
