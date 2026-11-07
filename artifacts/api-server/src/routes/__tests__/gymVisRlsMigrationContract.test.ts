import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Issue #682 Gym VIS RLS migration contract", () => {
  const sql = readFileSync(join(process.cwd(), "migrations/20261107_gym_vis_app_role_rls.sql"), "utf8");

  test("policies are restricted to the trusted app role and exact reader tables", () => {
    expect(sql).toContain("TO sport_center_app");
    expect(sql).toContain("gym_vis_app_insert");
    expect(sql).toContain("gym_vis_app_select");
    expect(sql).toContain("gym_vis_app_update");
    expect(sql).toContain("gym_vis_app_grant_insert");
    expect(sql).toContain("TDBD234200545");
    for (let i = 1; i <= 6; i++) expect(sql).toContain(`VIS${String(i).padStart(3, "0")}`);
    expect(sql).not.toMatch(/CREATE POLICY[^;]+TO\s+(?:anon|authenticated|PUBLIC)\b/i);
  });

  test("grant insert requires confirmed payment, booking ownership and pending state", () => {
    expect(sql).toContain("p.booking_id=b.id");
    expect(sql).toContain("p.id=payment_id");
    expect(sql).toContain("p.status::text=''confirmed''");
    expect(sql).toContain("b.source=''gym_public_guest''");
    expect(sql).toContain("access_state = ''pending''");
    expect(sql).toContain("identity_type = ''card''");
  });
});
