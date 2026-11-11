import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const entry = read("artifacts/sport-center/src/pages/GymNonmemberEntry.tsx");
const app = read("artifacts/sport-center/src/App.tsx");
const form = read("artifacts/sport-center/src/pages/wa/BookingForm.tsx");
const wa = read("artifacts/api-server/src/routes/whatsapp.ts");

test("existing gym URL and generic self-service URL both show the chooser", () => {
  assert.match(app, /<Route path="\/gym\/nonmember" component=\{GymNonmemberEntry\}/);
  assert.match(app, /<Route path="\/booking\/mandiri" component=\{GymNonmemberEntry\}/);
  assert.match(entry, /Pilih Layanan Olahraga/);
  assert.match(entry, /fetch\("\/api\/wa\/facilities"/);
  assert.match(entry, /facilities\.map\(/);
  assert.doesNotMatch(entry, /window\.location\.replace\(/);
});

test("only Gym enters the protected guest flow; other sports use existing WA checkout", () => {
  assert.match(entry, /isGym\(facility\) \? path \+ "\?nonmember=1&self=1" : path/);
  assert.match(entry, /\/wa\/booking\//);
  assert.match(form, /const publicGymGuest = dedicatedNonmember && searchParams\.get\("self"\) === "1"/);
  assert.match(wa, /if \(publicGymGuest\)/);
  assert.match(wa, /x904IdentityType != null \|\| x904IdentityValue != null/);
  assert.match(wa, /source: publicGymGuest \? "gym_public_guest" : "whatsapp"/);
});

test("the selector excludes unavailable/non-priced facilities while booking routes remain untouched", () => {
  assert.match(entry, /Number\(value\.pricePerHour\) > 0/);
  assert.match(entry, /typeof value\.id === "number"/);
  assert.match(app, /<Route path="\/wa\/booking\/:facilityId" component=\{WaBookingForm\}/);
  assert.match(entry, /Booking online tanpa login/);
});
