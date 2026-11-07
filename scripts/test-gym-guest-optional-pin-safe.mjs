import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../"+p,import.meta.url),"utf8");
const form = read("artifacts/sport-center/src/pages/wa/BookingForm.tsx");
const api = read("artifacts/api-server/src/routes/whatsapp.ts");
const admin = read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("public Gym never allows arbitrary unverified PIN self-selection",()=>{
 assert.doesNotMatch(form,/Pencocokan Identitas Gym X904/);
 assert.match(form,/Verifikasi PIN X904 untuk nama terdaftar/);
 assert.match(form,/type="password" inputMode="numeric"/);
 assert.match(form,/font-bold text-green-700 border-green-300/);
 assert.doesNotMatch(form,/PIN Mesin X904 \(Opsional\)/);
 assert.match(form,/publicGymGuest \|\| !dedicatedNonmember \|\| !x904IdentityValue\.trim\(\)/);
 assert.match(form,/\/api\/wa\/gym-name-route/);
 assert.doesNotMatch(form,/requestedX904Pin: x904IdentityValue/);
});
test("typed PIN and registered name create review-only grant, never a machine command",()=>{
 const bookingRoute=api.slice(api.indexOf('router.post("/wa/booking"'),api.indexOf('router.get("/wa/status/:orderNumber"'));
 assert.match(bookingRoute,/guestSubmittedPin/);
 assert.match(bookingRoute,/guestSubmittedPin !== guestNameRoute\.userPin/);
 assert.match(bookingRoute,/resolveGymGuestName\(bookingCustomerName\)/);
 assert.match(bookingRoute,/status review_required/);
 assert.match(bookingRoute,/if \(!gymWalkIn \|\| x904IdentityType != null \|\| x904IdentityValue != null\)/);
 assert.match(bookingRoute,/if \(verifiedX904Identity\) \{/);
 assert.match(bookingRoute,/guestNameRoute\.userPin/);
 assert.match(bookingRoute,/publicGymGuest \? "review_required" : "verified"/);
 assert.match(bookingRoute,/publicGymGuest \? "review_required" : "pending"/);
 assert.match(bookingRoute,/x904Identity: !publicGymGuest && verifiedX904Identity/);
 assert.match(bookingRoute,/const customer = publicGymGuest \? null : await ensureCustomer/);
 assert.match(bookingRoute,/GYM_PUBLIC_GUEST_DUPLICATE_BOOKING/);
 assert.doesNotMatch(bookingRoute,/ACTIVATE_USER|SUSPEND_USER/);
});
test("admin sees the request but cannot bypass official payment confirmation",()=>{
 assert.match(admin,/Identitas X904 yang diajukan pengunjung/);
 assert.match(admin,/Data dari pengunjung belum terverifikasi/);
 assert.match(admin,/detail\.booking\.source !== "gym_public_guest"/);
});
