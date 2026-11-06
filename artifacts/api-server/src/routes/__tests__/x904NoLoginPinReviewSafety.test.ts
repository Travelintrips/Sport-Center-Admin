import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("No-login ordinary PIN booking/payment isolation", () => {
  const wa = readFileSync(join(process.cwd(), "src/routes/whatsapp.ts"), "utf8");
  const bookings = readFileSync(join(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const migration = readFileSync("migrations/20261106_x904_guest_pin_payment_review_guard.sql", "utf8");
  const guestStart = wa.indexOf('router.post("/wa/booking"');
  const bookingEnd = wa.indexOf('router.get("/wa/status/', guestStart);
  const guest = wa.slice(guestStart, bookingEnd);

  test("anonymous form cannot select a PIN; registered name yields server-resolved PIN", () => {
    expect(guest).toContain("publicGymGuest && req.body.requestedX904Pin != null");
    expect(guest).toContain("publicGymGuest && guestNameRoute?.route === \"registered\"");
    expect(guest).toContain("guestNameRoute.userPin");
    expect(guest).toContain("guestNameRoute.deviceUid");
    expect(guest).toContain('identityType: "pin"');
    expect(guest).toContain("X904_NONMEMBER_PIN_BUSY");
  });
  test("booking is atomic and starts review_required, not automatic door activation", () => {
    expect(guest).toContain("pg_advisory_xact_lock(");
    expect(guest).toContain("x904_verified_nonmember_identities");
    expect(guest).toContain("FOR SHARE");
    expect(guest).toContain('${publicGymGuest ? "review_required" : "verified"}');
    expect(guest).toContain('${publicGymGuest ? "review_required" : "pending"}');
  });
  test("confirmed bank payment cannot bypass identity staff review for guests", () => {
    expect(migration).toContain("b.source='gym_public_guest'");
    expect(migration).toContain("AND a.identity_type='pin'");
    expect(migration).toContain("WHEN is_guest THEN 'review_required'");
    expect(migration).toContain("WHEN is_guest THEN 'review_required' ELSE 'verified'");
    expect(migration).toContain("NEW.status::text = 'confirmed'");
  });
  test("staff handoff requires authenticated role, payment, correct identity, and open hours", () => {
    const start = bookings.indexOf('router.post("/bookings/:bookingId/x904-guest-pin-approve"');
    expect(start).toBeGreaterThan(-1);
    const scope = bookings.slice(start, bookings.indexOf('router.post("/bookings"', start));
    expect(scope).toContain("verifyToken");
    expect(scope).toContain("isOperationalBookingRole");
    expect(scope).toContain("identityChecked !== true");
    expect(scope).toContain('grant.payment_status !== "confirmed"');
    expect(scope).toContain("hour < 6 || hour >= 23");
    expect(scope).toContain("x904_verified_nonmember_identities");
    expect(scope).toContain("gym_x904_member_mapping");
    expect(scope).toContain("SET verification_state='verified',access_state='pending'");
    expect(scope).not.toContain("ACTIVATE_USER");
    expect(scope).not.toContain("SUSPEND_USER");
  });
  test("VIS routes and anonymous no-login account creation remain unchanged", () => {
    expect(guest).toContain("const customer = publicGymGuest ? null : await ensureCustomer");
    expect(guest).toContain("verifiedX904Identity?.identityType === \"card\"");
    expect(guest).toContain("guestNameRoute?.route === \"visitor_card\"");
  });
});
