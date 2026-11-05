import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../artifacts/api-server/src/routes/whatsapp.ts", import.meta.url), "utf8");

test("same-phone same-day public guest bookings are locked and rechecked inside transaction", () => {
  const transactionStart = api.indexOf("const booking = await db.transaction", api.indexOf('router.post("/wa/booking"'));
  const insertStart = api.indexOf("tx.insert(bookingsTable).values", transactionStart);
  const section = api.slice(transactionStart, insertStart);
  assert.match(section, /if \(publicGymGuest\) \{/);
  assert.match(section, /pg_advisory_xact_lock/);
  assert.match(section, /hashtext\('gym_public_guest'\)/);
  assert.match(section, /customer_phone=/);
  assert.match(section, /booking_date=/);
  assert.match(section, /GYM_PUBLIC_GUEST_DUPLICATE_BOOKING/);
  assert.ok(section.indexOf("pg_advisory_xact_lock") < section.indexOf("SELECT 1 FROM sport_center.sport_bookings"));
  assert.ok(api.indexOf("SELECT 1 FROM sport_center.sport_bookings", transactionStart) < insertStart);
});

test("duplicate error is 409, guest has no login account and no X904 entitlement", () => {
  assert.match(api, /err\.message === "GYM_PUBLIC_GUEST_DUPLICATE_BOOKING"/);
  assert.match(api, /res\.status\(409\)\.json/);
  assert.match(api, /const customer = publicGymGuest \? null : await ensureCustomer/);
  assert.match(api, /if \(verifiedX904Identity\) \{/);
  assert.match(api, /x904IdentityType != null \|\| x904IdentityValue != null/);
});
