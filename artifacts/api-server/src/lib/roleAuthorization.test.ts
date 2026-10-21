import { canEditRole, isSessionCurrent } from "./roleAuthorization";

describe("Sport Center user role authorization", () => {
  const actor = (role: string, status = "active") => ({ id: 1, role, status });
  const target = (role: string, id = 2) => ({ id, role });

  test.each([
    ["owner", "customer", "super_admin", true],
    ["owner", "admin", "finance", true],
    ["owner", "owner", "admin", false],
    ["super_admin", "customer", "admin", true],
    ["super_admin", "admin", "admin_booking", true],
    ["super_admin", "admin", "super_admin", false],
    ["super_admin", "super_admin", "admin", false],
    ["super_admin", "owner", "customer", false],
    ["admin", "customer", "admin", false],
    ["admin_booking", "customer", "admin", false],
    ["customer", "customer", "admin", false],
  ])("%s changing %s to %s => %s", (a, b, c, expected) => {
    expect(canEditRole(actor(a), target(b), c)).toBe(expected);
  });
  it("rejects inactive actor, self edits, invalid roles", () => {
    expect(canEditRole(actor("owner", "inactive"), target("customer"), "admin")).toBe(false);
    expect(canEditRole(actor("owner"), target("customer", 1), "admin")).toBe(false);
    expect(canEditRole(actor("owner"), target("customer"), "owner")).toBe(false);
  });
  test.each([
    ["admin", {role:"admin",status:"active"}, true],
    ["admin", {role:"customer",status:"active"}, false],
    ["admin", {role:"admin",status:"inactive"}, false],
    ["admin", null, false],
  ])("token role %s vs database record => %s", (tokenRole, account, expected) => {
    expect(isSessionCurrent(tokenRole, account)).toBe(expected);
  });
});
