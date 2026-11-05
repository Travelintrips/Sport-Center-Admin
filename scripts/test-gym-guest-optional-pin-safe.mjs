import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../"+p,import.meta.url),"utf8");
const form = read("artifacts/sport-center/src/pages/wa/BookingForm.tsx");
const api = read("artifacts/api-server/src/routes/whatsapp.ts");
const admin = read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("public Gym displays optional PIN X904 and never uses untrusted input for identity lookup",()=>{
 assert.match(form,/PIN Mesin X904 \(Opsional\)/);
 assert.match(form,/id="gym-guest-requested-pin"/);
 assert.match(form,/publicGymGuest \|\| !dedicatedNonmember \|\| !x904IdentityValue\.trim\(\)/);
 assert.match(form,/publicGymGuest: true, requestedX904Pin: x904IdentityValue\.trim\(\) \|\| undefined/);
 assert.match(form,/PIN ini hanya permintaan pencocokan, bukan izin membuka pintu/);
});
test("untrusted PIN is merely a booking note: no grant, payment or machine command",()=>{
 const bookingRoute=api.slice(api.indexOf('router.post("/wa/booking"'),api.indexOf('router.get("/wa/status/:orderNumber"'));
 assert.match(bookingRoute,/const requestedX904Pin = publicGymGuest/);
 assert.match(bookingRoute,/PIN X904 diajukan:/);
 assert.match(bookingRoute,/BELUM terverifikasi oleh petugas/);
 assert.match(bookingRoute,/if \(!gymWalkIn \|\| x904IdentityType != null \|\| x904IdentityValue != null\)/);
 assert.match(bookingRoute,/if \(verifiedX904Identity\) \{/);
 assert.match(bookingRoute,/const customer = publicGymGuest \? null : await ensureCustomer/);
 assert.match(bookingRoute,/GYM_PUBLIC_GUEST_DUPLICATE_BOOKING/);
 assert.doesNotMatch(bookingRoute,/ACTIVATE_USER|SUSPEND_USER/);
});
test("admin sees the request but cannot bypass official payment confirmation",()=>{
 assert.match(admin,/Identitas X904 yang diajukan pengunjung/);
 assert.match(admin,/Data dari pengunjung belum terverifikasi/);
 assert.match(admin,/detail\.booking\.source !== "gym_public_guest"/);
});
