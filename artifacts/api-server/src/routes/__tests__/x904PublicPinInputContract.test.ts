import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym no-login ordinary PIN field and server-side match", () => {
  const form = readFileSync(join(process.cwd(), "../sport-center/src/pages/wa/BookingForm.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src/routes/whatsapp.ts"), "utf8");

  test("no-login guest sees green registered name without ever entering a PIN", () => {
    expect(form).toContain('className={publicGymGuest && guestIdentityRoute === "registered"');
    expect(form).toContain('font-bold text-green-700 border-green-300');
    expect(form).toContain('body:JSON.stringify({customerName:name})');
    expect(form).not.toContain('id="guest-x904-pin"');
    expect(form).not.toContain('requestedX904Pin: guestPin.trim()');
    expect(form).not.toContain('Cocokkan PIN');
  });

  test("backend resolves unique approved name and holds access for staff", () => {
    const start = api.indexOf('const publicGymGuest = req.body.publicGymGuest === true');
    const end = api.indexOf('const customer = publicGymGuest ? null : await ensureCustomer',start);
    const scope = api.slice(start,end);
    expect(scope).toContain('resolveGymGuestName(bookingCustomerName)');
    expect(scope).toContain('guestNameRoute?.route === "registered"');
    expect(scope).toContain('guestNameRoute.userPin');
    expect(scope).toContain('guestNameRoute.deviceUid');
    expect(scope).toContain('guestSubmittedPin && guestNameRoute?.route === "registered"');
    expect(scope).toContain('guestSubmittedPin !== guestNameRoute.userPin');
    expect(scope).toContain('X904_NONMEMBER_PIN_BUSY');
    expect(scope).toContain('x904_verified_nonmember_identities');
    expect(api).toContain('publicGymGuest ? "review_required" : "verified"');
    expect(api).toContain('publicGymGuest ? "review_required" : "pending"');
    expect(api).toContain('x904Identity: !publicGymGuest && verifiedX904Identity');
  });

  test("VIS path remains separate and anonymous cannot force a PIN/UID", () => {
    expect(api).toContain('guestNameRoute?.route === "visitor_card"');
    expect(api).toContain('verifiedX904Identity?.identityType === "card"');
    expect(api).toContain('publicGymGuest ? null : await ensureCustomer');
    expect(form).not.toContain('guestPinMatch');
    expect(form).not.toContain('guestPinChecking');
  });
});
