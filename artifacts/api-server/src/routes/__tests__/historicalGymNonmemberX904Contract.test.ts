import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("historical admin Gym booking must not mutate X904 access", () => {
  const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/CheckoutForm.tsx"), "utf8");
  const bookingRoute = route.split('router.post("/bookings", async (req, res) => {')[1]
    ?.split('router.post("/bookings/recurring"')[0] ?? route;

  it("limits historical bypass to operational admin Gym bookings before current WIB date", () => {
    expect(bookingRoute).toContain('const isHistoricalGymNonmember = isWalkIn');
    expect(bookingRoute).toContain('isAdminRequest && bookingSource === "admin" && isOperationalBookingRole(loggedInRole)');
    expect(bookingRoute).toContain('normalizedBookingDate < getTodayWIB()');
  });

  it("stores optional verified historical card only as a booking note", () => {
    expect(bookingRoute).toContain("notes: isHistoricalGymNonmember && verifiedX904Identity");
    expect(bookingRoute).toContain("X904 historis (referensi saja, tanpa akses)");
    expect(bookingRoute).toContain('const card = identityType === "card" ? resolveX904NonmemberCard(identityValue) : null');
  });

  it("never creates daily access entitlement for a past admin Gym booking", () => {
    expect(bookingRoute).toContain("if (verifiedX904Identity && !isHistoricalGymNonmember) {");
    expect(bookingRoute).toContain("INSERT INTO sport_center.x904_nonmember_daily_access");
  });

  it("retains required verified identity for present/future bookings but makes it optional for history", () => {
    expect(ui).toContain("const isHistoricalGymNonmember = isGymNonmember");
    expect(ui).toContain("selectedDate < jakartaDateOnly()");
    expect(ui).toContain('isHistoricalGymNonmember && !x904IdentityValue.trim()');
    expect(ui).toContain('isGymNonmember && (!isHistoricalGymNonmember || x904IdentityValue.trim())');
    expect(ui).toContain("Referensi identitas X904 historis (opsional)");
    expect(ui).toContain("tanpa aktivasi, suspend, atau perpanjangan akses X904");
  });
});
