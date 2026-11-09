import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const migration=readFileSync(resolve(process.cwd(),"../../migrations/20261109_sc_income_runtime_rls_policy.sql"),"utf8");
describe("SC income internal RLS policies",()=>{
 it("allows only the internal application DB role to select, insert and update",()=>{
  expect(migration).toContain("FOR SELECT TO sport_center_app");
  expect(migration).toContain("FOR INSERT TO sport_center_app");
  expect(migration).toContain("FOR UPDATE TO sport_center_app");
  expect(migration).not.toMatch(/FOR\s+(?:ALL|DELETE)\s+TO\s+sport_center_app/i);
  expect(migration).not.toMatch(/\bGRANT\b.*\b(?:anon|authenticated|PUBLIC)\b/i);
 });
 it("is idempotent and applies only to operational income table",()=>{
  expect((migration.match(/IF NOT EXISTS/g)||[]).length).toBe(3);
  expect(migration).toContain("ON sport_center.sc_income_entries");
  expect(migration).not.toMatch(/\bINSERT INTO\b|\bDELETE FROM\b|\bUPDATE\s+sport_center\.sc_income_entries\s+SET/i);
 });
});
