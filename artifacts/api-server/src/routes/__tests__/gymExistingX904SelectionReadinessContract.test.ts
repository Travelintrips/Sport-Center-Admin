import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/CheckoutForm.tsx"), "utf8");

describe("Gym new membership existing-X904 identity selection", () => {
  test("selected X904 PIN terminates candidate search instead of launching a second lookup", () => {
    expect(ui).toContain('memberAction !== "new" || membershipX904Pin || membershipX904Search.trim().length < 2');
    expect(ui).toContain('[isMembership,memberAction,membershipX904Search,membershipX904Pin]');
    expect(ui).toContain('setMembershipX904Search(item.name + " · PIN " + item.pin)');
    expect(ui).toContain('setMembershipX904Error("");');
  });
  test("membership validation remains independent of PIN preview and requires ownership confirmation", () => {
    expect(ui).toContain("membershipX904IdentityConfirmed && membershipX904Pin && membershipX904SelectedUid !== null");
    expect(ui).toContain('!membershipX904Checking && !membershipX904Error');
    expect(ui).toContain("membershipNewBlockers");
    expect(ui).toContain("Lengkapi sebelum mendaftarkan member:");
  });
  test("payment date/proof and server identity checks remain enforced", () => {
    expect(ui).toContain('!membershipPaymentFile || !membershipPaymentDate || membershipPaymentDate > jakartaDateOnly()');
    expect(ui).toContain('form.append("x904IdentityConfirmed",String(membershipX904IdentityConfirmed))');
    expect(ui).toContain('form.append("x904Pin",membershipX904Pin.trim())');
    expect(ui).toContain('form.append("paymentDate",membershipPaymentDate)');
  });
});
