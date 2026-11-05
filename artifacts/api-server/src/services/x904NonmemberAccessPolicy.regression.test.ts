import { decideNonmemberX904Access } from "./x904NonmemberAccessPolicy";

describe("X904 nonmember safety regression", () => {
  const base = {
    verifiedNonmemberPin: true,
    userPin: "109",
    deviceRole: 0,
    confirmedPaymentAt: new Date("2026-11-05T00:00:00Z"),
    paymentState: "confirmed" as const,
    currentGroup: 2,
    now: new Date("2026-11-05T01:00:00Z"),
  };

  test.each(["12", "79", "237"])("exempt PIN %s never activates", userPin => {
    expect(decideNonmemberX904Access({ ...base, userPin })).toBe("hold");
  });
  test("role 14 never activates", () => {
    expect(decideNonmemberX904Access({ ...base, deviceRole: 14 })).toBe("hold");
  });
  test("verified ordinary nonmember may activate", () => {
    expect(decideNonmemberX904Access(base)).toBe("activate");
  });
  test("unverified legacy PIN never activates or suspends", () => {
    expect(decideNonmemberX904Access({ ...base, verifiedNonmemberPin: false, currentGroup: 1 })).toBe("hold");
  });
  test("expired verified ordinary nonmember may suspend", () => {
    expect(decideNonmemberX904Access({ ...base, currentGroup: 1, now: new Date("2026-11-06T01:00:00Z") })).toBe("suspend");
  });
});
