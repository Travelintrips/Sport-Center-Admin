import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../artifacts/api-server/src/services/x904LanWaNotifications.ts", import.meta.url), "utf8");

test("card and ordinary PIN visitors both require verified access and matching machine identity", () => {
  assert.match(src, /access\.identity_type IN \('card','pin'\)/);
  assert.match(src, /access\.verification_state='verified'/);
  assert.match(src, /access\.device_serial=u\.device_serial/);
  assert.match(src, /access\.user_pin=u\.user_pin/);
  assert.match(src, /access\.device_uid=u\.device_uid/);
  assert.match(src, /lower\(btrim\(access\.verified_name\)\)=lower\(btrim\(u\.display_name\)\)/);
});

test("monthly member markers have priority, unverified visitors remain unmarked", () => {
  assert.match(src, /person\.membershipStatus === "active" \? " 🟢 M"/);
  assert.match(src, /person\.membershipStatus === "expired" \? " 🔴 ME"/);
  assert.match(src, /person\.isVerifiedVisitor \? " 🔵 V" : ""/);
});
