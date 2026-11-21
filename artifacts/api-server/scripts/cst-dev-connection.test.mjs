import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCstDevTransactionPooler, CST_DEV_PROJECT_REF, CST_DEV_SHARED_POOLER_HOST } from "./cst-dev-connection.mjs";

const secret = "EXAMPLE_QA_PASSWORD_NOT_REAL";
const dedicated = `postgresql://postgres:${secret}@db.${CST_DEV_PROJECT_REF}.supabase.co:6543/postgres`;
const shared = `postgresql://postgres.${CST_DEV_PROJECT_REF}:${secret}@${CST_DEV_SHARED_POOLER_HOST}:5432/postgres`;
test("dedicated CST-DEV URI maps to existing shared transaction pooler", () => {
  const r=normalizeCstDevTransactionPooler(dedicated);
  assert.equal(r.source,"dedicated");
  const u=new URL(r.connectionString);
  assert.equal(u.hostname,CST_DEV_SHARED_POOLER_HOST);
  assert.equal(u.username,`postgres.${CST_DEV_PROJECT_REF}`);
  assert.equal(u.port,"6543");
  assert.equal(u.password,secret);
});
test("shared CST-DEV session mode is normalized to transaction port 6543", () => {
  const r=normalizeCstDevTransactionPooler(shared);
  assert.equal(r.source,"shared");
  assert.equal(new URL(r.connectionString).port,"6543");
});
test("wrong projects, arbitrary pooler clusters and empty credentials are rejected", () => {
  const invalid=[
    dedicated.replace(CST_DEV_PROJECT_REF,"nzdweipzckfszczzqtuw"),
    shared.replace(CST_DEV_PROJECT_REF,"nzdweipzckfszczzqtuw"),
    shared.replace("aws-1-ap-southeast-2","aws-0-ap-southeast-2"),
    dedicated.replace(`:${secret}@`,":@"),
    "postgresql://postgres:secret@localhost:6543/postgres",
    dedicated.replace(":6543/postgres",":5432/postgres"),
  ];
  for(const u of invalid) assert.throws(()=>normalizeCstDevTransactionPooler(u));
});
test("normalization is pure and preserves URL-encoded password bytes", () => {
  const value=dedicated.replace(secret,"PAS%40S%3AWORD");
  assert.equal(new URL(normalizeCstDevTransactionPooler(value).connectionString).password,"PAS%40S%3AWORD");
  assert.ok(value.includes("db."));
});

test("Supabase password placeholders are not usable database passwords", () => {
  for (const placeholder of ["[YOUR-DATABASE-PASSWORD]", "[YOUR-PASSWORD]", "YOUR_PASSWORD"]) {
    const v=dedicated.replace(secret,encodeURIComponent(placeholder));
    assert.throws(()=>normalizeCstDevTransactionPooler(v),/CST_DEV_PASSWORD_PLACEHOLDER_NOT_REPLACED/);
  }
});
