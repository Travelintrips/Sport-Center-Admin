import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const ref = "abcdefghijklmnopqrst";
const good = {
  NODE_ENV: "production",
  SPORT_CENTER_INSTALLATION_ID: "customer-a-sport",
  SPORT_CENTER_PUBLIC_URL: "https://sport.customer-a.example",
  SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_DATABASE_URL: `postgresql://postgres.${ref}:fake@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
  SUPABASE_SERVICE_ROLE_KEY: "x".repeat(64),
  SESSION_SECRET: "y".repeat(64),
  GYM_X904_EVENT_INGEST_KEY: "z".repeat(64),
  CST_WA_GATEWAY_TOKEN: "w".repeat(64),
  GYM_X904_DEVICE_SERIAL: "CERT-CLIENT-A-X904",
  ALLOW_DEV_ON_PROD_DB: "false",
  ALLOW_DEV_ON_PROD_STORAGE: "false"
};
function check(overrides = {}) {
  const result = spawnSync(process.execPath, ["scripts/certification/managed-install-preflight.mjs"], {
    env: {...process.env,...good,...overrides},encoding:"utf8",cwd:process.cwd()
  });
  assert.equal(result.error,undefined);
  return { status:result.status,output:JSON.parse(result.stdout) };
}
test("a dedicated synthetic installation preflight is accepted", () => {
  const r=check();assert.equal(r.status,0);assert.equal(r.output.passed,true);
});
test("CST project or CST machine cannot be reused as customer's installation", () => {
  const refCST="nzdweipzckfszczzqtuw";
  const r=check({SUPABASE_URL:`https://${refCST}.supabase.co`,
    SUPABASE_DATABASE_URL:`postgresql://postgres.${refCST}:fake@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`,
    GYM_X904_DEVICE_SERIAL:"TDBD234200545"});
  assert.equal(r.status,2);assert.ok(r.output.errors.includes("CST_DATABASE_PROJECT_FORBIDDEN"));
  assert.ok(r.output.errors.includes("CST_X904_SERIAL_FORBIDDEN"));
});
test("a mismatched pooler project fails closed", () => {
  const r=check({SUPABASE_DATABASE_URL:"postgresql://postgres.differentref1234567:fake@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres"});
  assert.equal(r.status,2);assert.ok(r.output.errors.includes("DATABASE_SUPABASE_PROJECT_MISMATCH"));
});
test("developer cross-environment override is prohibited", () => {
  const r=check({ALLOW_DEV_ON_PROD_DB:"true"});
  assert.equal(r.status,2);assert.ok(r.output.errors.includes("UNSAFE_DEV_OVERRIDE"));
});
test("missing credentials fail closed without disclosing secrets", () => {
  const r=check({SESSION_SECRET:""});
  assert.equal(r.status,2);assert.ok(r.output.errors.includes("SESSION_SECRET_MISSING_OR_TOO_SHORT"));
  assert.ok(!JSON.stringify(r.output).includes("y".repeat(64)));
});
