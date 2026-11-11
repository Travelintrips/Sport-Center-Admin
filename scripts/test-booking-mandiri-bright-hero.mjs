import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page=readFileSync(new URL("../artifacts/sport-center/src/pages/GymNonmemberEntry.tsx",import.meta.url),"utf8");
test("bright split hero shows true building image without dark full-screen overlay",()=>{
 assert.match(page,/lg:grid-cols-\[0\.95fr_1\.05fr\]/);
 assert.match(page,/src=\{buildingImg\}/);
 assert.match(page,/brightness-\[1\.06\]/);
 assert.match(page,/bg-gradient-to-br from-emerald-100 to-orange-100/);
 assert.doesNotMatch(page,/bg-gradient-to-r from-\[#09162b\]\/95/);
 assert.match(page,/Pilih Fasilitas & Booking/);
 assert.match(page,/Kembali ke Beranda/);
});
test("facilities remain live and Gym still enters protected checkout",()=>{
 assert.match(page,/fetch\("\/api\/wa\/facilities"/);
 assert.match(page,/Number\(value\.pricePerHour\) > 0/);
 assert.match(page,/isGym\(facility\) \? path \+ "\?nonmember=1&self=1" : path/);
 assert.match(page,/Setelah pembayaran diverifikasi, akses fasilitas akan diberikan/);
 assert.doesNotMatch(page,/ACTIVATE_USER|SUSPEND_USER/);
});
