import {describe,it,expect,beforeEach,afterEach} from "@jest/globals";
import bcrypt from "bcryptjs";
import {verifyKasbonPassword,issueKasbonGrant,checkKasbonGrant} from "./scKasbonActionGate";

const testPassword="TEST_ONLY_never_a_real_password_827!";
const oldHash=process.env.SC_KASBON_ACTION_PASSWORD_HASH;
const oldKey=process.env.SC_KASBON_ACTION_SIGNING_KEY;
beforeEach(()=>{
 process.env.SC_KASBON_ACTION_PASSWORD_HASH=bcrypt.hashSync(testPassword,5);
 process.env.SC_KASBON_ACTION_SIGNING_KEY="a2".repeat(32);
});
afterEach(()=>{
 if(oldHash===undefined)delete process.env.SC_KASBON_ACTION_PASSWORD_HASH;
 else process.env.SC_KASBON_ACTION_PASSWORD_HASH=oldHash;
 if(oldKey===undefined)delete process.env.SC_KASBON_ACTION_SIGNING_KEY;
 else process.env.SC_KASBON_ACTION_SIGNING_KEY=oldKey;
});
describe("Kasbon dedicated action gate",()=>{
 it("fails closed without server-only secrets",async()=>{
  delete process.env.SC_KASBON_ACTION_PASSWORD_HASH;
  expect((await verifyKasbonPassword(testPassword,101,"unit-a")).status).toBe("disabled");
  expect(checkKasbonGrant("x",101,"SC003",4)).toBe(false);
 });
 it("rejects incorrect password and accepts correct independent of admin roles",async()=>{
  expect((await verifyKasbonPassword("wrong-but-long-enough",101,"unit-b")).status).toBe("invalid");
  expect((await verifyKasbonPassword(testPassword,101,"unit-b")).status).toBe("ok");
 });
 it("accepts a shorter user-configured password but still checks bcrypt hash",async()=>{
  const configured="Kasbon#9";
  process.env.SC_KASBON_ACTION_PASSWORD_HASH=bcrypt.hashSync(configured,5);
  expect((await verifyKasbonPassword(configured,114,"unit-short")).status).toBe("ok");
  expect((await verifyKasbonPassword("not-the-password",114,"unit-short")).status).toBe("invalid");
  expect((await verifyKasbonPassword("",114,"unit-short")).status).toBe("invalid");
 });
 it("binds token to account, employee and single record; rejects tampering",async()=>{
  const token=issueKasbonGrant(101,"SC003",4);
  expect(checkKasbonGrant(token,101,"SC003",4)).toBe(true);
  expect(checkKasbonGrant(token,102,"SC003",4)).toBe(false);
  expect(checkKasbonGrant(token,101,"SC009",4)).toBe(false);
  expect(checkKasbonGrant(token,101,"SC003",14)).toBe(false);
  expect(checkKasbonGrant(token.split(".")[0]+"."+ (token.split(".")[1][0]==="a"?"b":"a")+token.split(".")[1].slice(1),101,"SC003",4)).toBe(false);
 });
 it("locks repeated wrong-password attempts",async()=>{
  for(let i=0;i<4;i++)expect((await verifyKasbonPassword("wrong-but-long-enough",103,"unit-lock")).status).toBe("invalid");
  expect((await verifyKasbonPassword("wrong-but-long-enough",103,"unit-lock")).status).toBe("locked");
  expect((await verifyKasbonPassword(testPassword,103,"unit-lock")).status).toBe("locked");
 });
});
