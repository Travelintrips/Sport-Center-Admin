import { isNewOrdinaryX904Candidate, isSafeReenrollment } from "./x904NewOrdinaryUserDefaultSuspend";
import { decideNonmemberX904Access, x904NonmemberEffectiveExpiry } from "./x904NonmemberAccessPolicy";

describe("new ordinary X904 device user stays suspended until verified paid entitlement", () => {
  const oldPins = new Set(["200", "78", "1", "79", "237"]);
  const user = { pin: "600", name: "NEW VISITOR", role: 0, group: 1, enabled: true };
  test("only a newly appearing ordinary role-0 user in Group 1 qualifies", () => {
    expect(isNewOrdinaryX904Candidate(user, oldPins)).toBe(true);
    expect(isNewOrdinaryX904Candidate({ ...user, group: 2 }, oldPins)).toBe(false);
    expect(isNewOrdinaryX904Candidate({ ...user, enabled: false }, oldPins)).toBe(false);
    expect(isNewOrdinaryX904Candidate({ ...user, pin: "200" }, oldPins)).toBe(false);
    expect(isNewOrdinaryX904Candidate({ ...user, name: "" }, oldPins)).toBe(false);
  });
  test.each([4, 14, 1, 2, 3])("role %s is excluded", role => {
    expect(isNewOrdinaryX904Candidate({ ...user, role }, oldPins)).toBe(false);
  });
  test.each(["12", "79", "237"])("exception PIN %s is excluded", pin => {
    expect(isNewOrdinaryX904Candidate({ ...user, pin }, new Set())).toBe(false);
  });
  test("no payment means no activation, and role 4/14 never auto control", () => {
    const base = { verifiedNonmemberPin: true, userPin: "600",
      deviceRole: 0, confirmedPaymentAt: null, paymentState: "pending" as const,
      currentGroup: 2, now: new Date("2026-11-07T04:00:00Z") };
    expect(decideNonmemberX904Access(base)).toBe("hold");
    const paid = { ...base, confirmedPaymentAt: new Date("2026-11-07T03:00:00Z"),
      paymentState: "confirmed" as const };
    expect(decideNonmemberX904Access(paid)).toBe("activate");
    // Preserve the existing special-role paid activation allowance. This
    // change only prevents new-enrollment default suspension for those roles.
    for (const role of [4,14]) {
      expect(decideNonmemberX904Access({ ...paid, deviceRole: role })).toBe("activate");
      expect(decideNonmemberX904Access({ ...paid, deviceRole: role, currentGroup: 1,
        now: new Date("2026-11-08T04:00:00Z") })).toBe("hold");
    }
  });
  test("expires no later than activation + 12 hours or 23:00 WIB", () => {
    const a = new Date("2026-11-07T04:00:00Z"); // 11:00 WIB
    expect(x904NonmemberEffectiveExpiry(a)?.toISOString()).toBe("2026-11-07T16:00:00.000Z"); // 23:00 WIB
    const b = new Date("2026-11-07T00:00:00Z"); // 07:00 WIB
    expect(x904NonmemberEffectiveExpiry(b)?.toISOString()).toBe("2026-11-07T12:00:00.000Z"); // 19:00 WIB
  });
});

describe("historical PIN reused after removal",()=>{
 const toms={pin:"10",name:"TOMS",oldName:"KARTU 07",oldRole:0,absentSnapshots:2,gapMinutes:5500};
 test("PIN 10 TOMS follows safe re-enrollment",()=>expect(isSafeReenrollment(toms)).toBe(true));
 test("same identity or incomplete absence is held",()=>{
  expect(isSafeReenrollment({...toms,name:"KARTU 07"})).toBe(false);
  expect(isSafeReenrollment({...toms,absentSnapshots:1})).toBe(false);
  expect(isSafeReenrollment({...toms,gapMinutes:3})).toBe(false);
 });
 test.each(["12","79","237"])("special PIN %s held",pin=>expect(isSafeReenrollment({...toms,pin})).toBe(false));
 test.each([4,14])("special role %s held",role=>expect(isSafeReenrollment({...toms,oldRole:role})).toBe(false));
});
