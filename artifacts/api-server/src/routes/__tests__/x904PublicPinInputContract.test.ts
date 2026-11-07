import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym no-login ordinary PIN field and server-side match", () => {
  const form = readFileSync(join(process.cwd(), "../sport-center/src/pages/wa/BookingForm.tsx"), "utf8");
  const api = readFileSync(join(process.cwd(), "src/routes/whatsapp.ts"), "utf8");

  test("public self-service renders owner-entered PIN and includes it only in guest booking payload", () => {
    expect(form).toContain('htmlFor="guest-x904-pin"');
    expect(form).toContain('id="guest-x904-pin"');
    expect(form).toContain("requestedX904Pin: guestPin.trim()");
    expect(form).toContain('guestIdentityRoute === "registered" && !guestPin.trim()');
    expect(form).toContain('value={guestPin}');
  });

  test("server rejects unverified/incorrect submitted PIN before booking and payment creation", () => {
    const start = api.indexOf("const publicGymGuest = req.body.publicGymGuest === true");
    const end = api.indexOf("const customer = publicGymGuest ? null : await ensureCustomer", start);
    const scope = api.slice(start, end);
    expect(scope).toContain("guestSubmittedPin");
    expect(scope).toContain("/^[0-9]{1,8}$/.test(guestSubmittedPin)");
    expect(scope).toContain('guestNameRoute?.route === "registered"');
    expect(scope).toContain("guestSubmittedPin !== guestNameRoute.userPin");
    expect(scope).toContain('guestNameRoute?.route !== "registered"');
    expect(scope).toContain('res.status(409)');
    expect(scope.indexOf("guestSubmittedPin !== guestNameRoute.userPin"))
      .toBeLessThan(scope.indexOf("let verifiedX904Identity"));
  });

  test("name match does not grant physical access and does not reveal PIN to anonymous booking response", () => {
    expect(api).toContain('publicGymGuest ? "review_required" : "verified"');
    expect(api).toContain('publicGymGuest ? "review_required" : "pending"');
    expect(api).toContain("x904Identity: !publicGymGuest && verifiedX904Identity");
    expect(api).toContain("const customer = publicGymGuest ? null : await ensureCustomer");
  });

  test("VIS card path stays outside owner PIN matching", () => {
    expect(api).toContain('guestSubmittedPin && guestNameRoute?.route !== "registered"');
    expect(api).toContain('verifiedX904Identity?.identityType === "card"');
    expect(form).toContain('guestIdentityRoute === "visitor_card"');
  });
  test("public ordinary PIN checkout blocks mismatch before submission and does not reveal registry PIN", () => {
    expect(form).toContain('guestIdentityRoute === "registered" && guestPinMatch !== true');
    expect(form).toContain('guestPin.trim() && guestPinMatch === false');
    expect(form).toContain('Pemeriksaan PIN X904 belum selesai');
    expect(form).toContain('Nama dan PIN X904 tidak cocok. Periksa kembali sebelum membuat booking.');
    expect(form).toContain('PIN X904 yang Anda masukkan');
    expect(form).toContain('{guestPin}');
    expect(form).toContain('publicGymGuest && guestPin.trim() && guestPinMatch === true');
  });

  test("PIN lookup is on-demand, handles rate limits and does not unlock the checkout on API errors", () => {
    expect(form).toContain('async function checkGuestPinIdentity()');
    expect(form).toContain('onClick={() => void checkGuestPinIdentity()}');
    expect(form).toContain('response.status === 429');
    expect(form).toContain('response.status === 503');
    expect(form).toContain('guestLookupAbort.current?.abort()');
    expect(form).toContain('guestPin.trim() && (guestIdentityRoute !== "registered" || guestPinMatch !== true)');
    const start = form.indexOf('// Identity preview runs only on demand.');
    const end = form.indexOf('async function checkGuestPinIdentity()', start);
    expect(start).toBeGreaterThan(-1);
    expect(form.slice(start,end)).not.toContain('fetch("/api/wa/gym-name-route"');
  });

});
