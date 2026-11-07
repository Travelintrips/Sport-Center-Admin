import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym no-login ordinary PIN field and server-side match", () => {
  const form = readFileSync(join(process.cwd(), "../sport-center/src/pages/wa/BookingForm.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src/routes/whatsapp.ts"), "utf8");

  test("no-login guest sees green registered name without ever entering a PIN", () => {
    expect(form).toContain('guestIdentityRoute === "registered" || guestIdentityRoute === "expired_member"');
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
    expect(api).toContain('X904_NONMEMBER_PIN_BUSY');
    expect(scope).toContain('x904_verified_nonmember_identities');
    expect(api).toContain('publicGymGuest ? "review_required" : "verified"');
    expect(api).toContain('publicGymGuest ? "review_required" : "pending"');
    expect(api).toContain('x904Identity: !publicGymGuest && verifiedX904Identity');
  });

  test("booking WhatsApp uses visible +62 prefix but sends canonical 628 number", () => {
    expect(form).toContain('Kode negara Indonesia, plus enam dua');
    expect(form).toContain('> +62');
    expect(form).toContain('placeholder="8123456789"');
    expect(form).toContain('value={localWhatsappDigits(form.customerPhone)}');
    expect(form).toContain('normalizedWhatsappNumber(e.target.value)');
    expect(form).toContain('customerPhone: normalizedWhatsappNumber(phoneFromWA)');
    expect(form).toContain('customerPhone: form.customerPhone,');
    expect(form).toContain('/^628[0-9]{7,13}$/.test(form.customerPhone.trim())');
    expect(form).toContain('if (digits.startsWith("628")) return digits.slice(2)');
    expect(form).toContain('if (digits.startsWith("0")) return digits.slice(1)');
    expect(form).toContain('local ? `62${local}` : ""');
  });

  test("VIS path remains separate and anonymous cannot force a PIN/UID", () => {
    expect(api).toContain('guestNameRoute?.route === "visitor_card"');
    expect(api).toContain('verifiedX904Identity?.identityType === "card"');
    expect(api).toContain('publicGymGuest ? null : await ensureCustomer');
    expect(form).not.toContain('guestPinMatch');
    expect(form).not.toContain('guestPinChecking');
  });
  test("fully expired mapped member is eligible for daily booking but never gets former PIN access", () => {
    const routing = readFileSync(join(process.cwd(), "src/services/x904GymGuestNameRouting.ts"), "utf8");
    expect(routing).toContain('membership_status) === "expired"');
    expect(routing).toContain("m.status::text='active'");
    expect(routing).toContain('route: "recognized_review"');
    expect(routing).toContain('route: "expired_member", userPin: null, deviceUid: null');
    expect(api).toContain('guestNameRoute?.route === "expired_member"');
    expect(api).toContain("PIN membership lama tidak diberikan hak akses");
    expect(form).toContain('guestIdentityRoute === "expired_member"');
    expect(form).toContain("tiket harian boleh dipesan");
  });

});
