import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const home = readFileSync(new URL("../artifacts/sport-center/src/pages/Home.tsx",import.meta.url),"utf8");
const app = readFileSync(new URL("../artifacts/sport-center/src/App.tsx",import.meta.url),"utf8");
const chooser = readFileSync(new URL("../artifacts/sport-center/src/pages/GymNonmemberEntry.tsx",import.meta.url),"utf8");

test("public homepage Book Now buttons open booking without login",()=>{
  const hrefs=[...home.matchAll(/<Link href="([^"]+)">\s*\{t\("Booking Mandiri Tanpa Login", "Book Without Login"\)/g)];
  assert.equal(hrefs.length,2);
  assert.ok(hrefs.every(match=>match[1]==="/booking/mandiri"));
  assert.match(home,/<Link href="\/facilities">\s*\{t\("Lihat Fasilitas", "View Facilities"\)/);
});
test("public booking route continues to render chooser with safe Gym routing",()=>{
  assert.match(app,/<Route path="\/booking\/mandiri" component=\{GymNonmemberEntry\}/);
  assert.match(app,/<Route path="\/gym\/nonmember" component=\{GymNonmemberEntry\}/);
  assert.match(chooser,/getPublicBookingLink/);
  assert.match(chooser,/\?nonmember=1&self=1/);
});
