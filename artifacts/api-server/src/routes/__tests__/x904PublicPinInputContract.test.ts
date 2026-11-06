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
});
