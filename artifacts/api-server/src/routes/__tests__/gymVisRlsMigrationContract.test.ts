import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Issue #682: production-equivalent Gym VIS role policies", () => {
 const sql = readFileSync(join(process.cwd(),"migrations/20261107_gym_vis_app_role_rls.sql"),"utf8");

 test("all six production policy names remain app-role only", () => {
  const names = [
   "gym_vis_app_select", "gym_vis_app_insert", "gym_vis_app_update",
   "x904_nonmember_app_select", "x904_nonmember_app_insert", "x904_nonmember_app_update"
  ];
  for (const name of names) expect(sql).toContain("CREATE POLICY "+name+" ON");
  expect(sql).not.toContain("gym_vis_app_grant_insert");
  expect((sql.match(/CREATE POLICY /g)||[]).length).toBe(6);
  expect(sql).not.toMatch(/CREATE POLICY[^;]+TO\s+(?:anon|authenticated|PUBLIC)\b/i);
 });

 test("VIS pairing, verified payment and booking status remain restricted", () => {
  for (const [card,pin,uid] of [["VIS001","78","338"],["VIS002","90","339"],["VIS003","13","13"],["VIS004","17","17"],["VIS005","11","11"],["VIS006","15","15"]]) {
   expect(sql).toContain("card_code = '"+card+"'");
   expect(sql).toContain("user_pin = '"+pin+"'");
   expect(sql).toContain("device_uid = "+uid);
  }
  expect(sql).toContain("b.status");
  expect(sql).toContain("p.status");
  expect(sql).toContain("gym_public_guest");
  expect(sql).toContain("verification_state = 'pending'");
  expect(sql).toContain("activated_at IS NULL");
 });
});
