import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page=readFileSync(new URL("../artifacts/sport-center/src/pages/GymNonmemberEntry.tsx",import.meta.url),"utf8");
const home=readFileSync(new URL("../artifacts/sport-center/src/pages/Home.tsx",import.meta.url),"utf8");
test("premium booking page reuses the real building asset",()=>{
 const path=/import buildingImg from "([^"]+)"/.exec(page)?.[1];
 assert.ok(path);
 assert.ok(home.includes('from "'+path+'"'));
 assert.match(page,/src=\{buildingImg\}/);
 assert.match(page,/Pilih Fasilitas & Booking/);
});
test("dynamic prices and safe guest Gym route remain unchanged",()=>{
 assert.match(page,/fetch\("\/api\/wa\/facilities"/);
 assert.match(page,/Number\(value\.pricePerHour\) > 0/);
 assert.match(page,/facilities\.map\(facility =>/);
 assert.match(page,/isGym\(facility\) \? path \+ "\?nonmember=1&self=1" : path/);
 assert.match(page,/Setelah pembayaran diverifikasi, fasilitas siap digunakan/);
 assert.doesNotMatch(page,/ACTIVATE_USER|SUSPEND_USER/);
});
