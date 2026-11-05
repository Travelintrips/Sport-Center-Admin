import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../artifacts/api-server/src/routes/whatsapp.ts", import.meta.url), "utf8");
const form = readFileSync(new URL("../artifacts/sport-center/src/pages/wa/BookingForm.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../artifacts/sport-center/src/pages/GymNonmemberEntry.tsx", import.meta.url), "utf8");

test("the public self-service entry is account-free and uses the existing proof flow", () => {
  assert.match(entry, /nonmember=1&self=1/);
  assert.match(form, /publicGymGuest: true/);
  assert.match(form, /fetch\("\/api\/wa\/booking"/);
  assert.match(form, /uploadProofForBooking\(bookingResult\)/);
  assert.match(form, /getStatus|Cek Status Booking/);
});

test("public self-service does not accept X904 PIN/card nor issue a physical grant", () => {
  assert.match(api, /if \(publicGymGuest\)/);
  assert.match(api, /x904IdentityType != null \|\| x904IdentityValue != null/);
  assert.match(api, /const customer = publicGymGuest \? null : await ensureCustomer/);
  assert.match(api, /source: publicGymGuest \? "gym_public_guest" : "whatsapp"/);
  assert.match(api, /if \(verifiedX904Identity\) \{/);
  assert.match(form, /!publicGymGuest && gymWalkIn && x904IdentityValue\.trim\(\)/);
  assert.match(form, /gymWalkIn && !publicGymGuest &&/);
});

test("guest payment remains pending and admin/member legacy paths stay unchanged", () => {
  assert.match(api, /status: "pending_payment"/);
  assert.match(api, /verification_state='verified'/);
  assert.match(api, /identityType === "pin"/);
  assert.match(api, /const effectiveDurationHours = gymWalkIn \? 1 : Number\(durationHours\)/);
});
