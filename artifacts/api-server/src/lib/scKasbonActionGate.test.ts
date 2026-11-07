import {describe,it,expect,beforeEach,afterEach} from "@jest/globals";
import bcrypt from "bcryptjs";
import {verifyKasbonPassword,issueKasbonGrant,checkKasbonGrant} from "./scKasbonActionGate";

const testPassword="X7#m9Q2p4!";
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
 it("allows passwords of six through twelve characters only",async()=>{
  process.env.SC_KASBON_ACTION_PASSWORD_HASH=bcrypt.hashSync("A7$x2Q",5);
  expect((await verifyKasbonPassword("A7$x2Q",104,"unit-length")).status).toBe("ok");
  expect((await verifyKasbonPassword("short",104,"unit-length")).status).toBe("invalid");
  expect((await verifyKasbonPassword("LongerThan12!",104,"unit-length")).status).toBe("invalid");
 });
 it("fails closed without server-only secrets",async()=>{
  delete process.env.SC_KASBON_ACTION_PASSWORD_HASH;
  expect((await verifyKasbonPassword(testPassword,101,"unit-a")).status).toBe("disabled");
  expect(checkKasbonGrant("x",101,"SC003",4)).toBe(false);
 });
 it("rejects incorrect password and accepts correct independent of admin roles",async()=>{
  expect((await verifyKasbonPassword("badwrong",101,"unit-b")).status).toBe("invalid");
  expect((await verifyKasbonPassword(testPassword,101,"unit-b")).status).toBe("ok");
 });
 it("binds token to account, employee and single record; rejects tampering",async()=>{
  const token=issueKasbonGrant(101,"SC003",4);
  expect(checkKasbonGrant(token,101,"SC003",4)).toBe(true);
  expect(checkKasbonGrant(token,102,"SC003",4)).toBe(false);
  expect(checkKasbonGrant(token,101,"SC009",4)).toBe(false);
  expect(checkKasbonGrant(token,101,"SC003",14)).toBe(false);
  expect(checkKasbonGrant(token.slice(0,-1)+"a",101,"SC003",4)).toBe(false);
 });
 it("locks repeated wrong-password attempts",async()=>{
  for(let i=0;i<4;i++)expect((await verifyKasbonPassword("wrong-but-long-enough",103,"unit-lock")).status).toBe("invalid");
  expect((await verifyKasbonPassword("wrong-but-long-enough",103,"unit-lock")).status).toBe("locked");
  expect((await verifyKasbonPassword(testPassword,103,"unit-lock")).status).toBe("locked");
 });
});
