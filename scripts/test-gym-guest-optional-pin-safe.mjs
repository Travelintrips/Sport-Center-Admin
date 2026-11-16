import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../"+p,import.meta.url),"utf8");
const form = read("artifacts/sport-center/src/pages/wa/BookingForm.tsx");
const api = read("artifacts/api-server/src/routes/whatsapp.ts");
const admin = read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("public Gym never allows arbitrary unverified PIN self-selection",()=>{
 assert.doesNotMatch(form,/Pencocokan Identitas Gym X904/);
 assert.doesNotMatch(form,/id="guest-x904-pin"/);
 assert.doesNotMatch(form,/requestedX904Pin: guestPin/);
 assert.match(form,/font-bold text-green-700 border-green-300/);
 assert.doesNotMatch(form,/PIN Mesin X904 \(Opsional\)/);
 assert.match(form,/publicGymGuest \|\| !dedicatedNonmember \|\| !x904IdentityValue\.trim\(\)/);
 assert.match(form,/\/api\/wa\/gym-name-route/);
 assert.doesNotMatch(form,/requestedX904Pin: x904IdentityValue/);
 assert.match(form,/requestedX904Pin: selfGymMachinePin.trim\(\)/);
 assert.match(form,/guestIdentityRoute === "registered"/);
 assert.match(form,/PIN mesin X904 \*/);
});
test("server-resolved name+PIN may prepare unpaid grant; no device command until bank confirms",()=>{
 const bookingRoute=api.slice(api.indexOf('router.post("/wa/booking"'),api.indexOf('router.get("/wa/status/:orderNumber"'));
 assert.match(bookingRoute,/guestSubmittedPin/);
 assert.match(bookingRoute,/guestNameRoute\?\.route!=="registered"/);
 assert.match(bookingRoute,/guestSubmittedPin!==guestNameRoute\.userPin/);
 assert.match(bookingRoute,/gymGuestPinFailures/);
 assert.match(bookingRoute,/resolveGymGuestName\(bookingCustomerName\)/);
 assert.match(bookingRoute,/selfGymMachinePinMatched/);
 assert.match(bookingRoute,/if \(!gymWalkIn \|\| x904IdentityType != null \|\| x904IdentityValue != null\)/);
 assert.match(bookingRoute,/if \(verifiedX904Identity\) \{/);
 assert.match(bookingRoute,/guestNameRoute\.userPin/);
 assert.match(bookingRoute,/publicGymGuest && !selfGymMachinePinMatched \? "review_required" : "verified"/);
 assert.match(bookingRoute,/publicGymGuest && !selfGymMachinePinMatched \? "review_required" : "pending"/);
 const newTrigger=read("artifacts/api-server/migrations/20261116_x904_verified_self_pin_auto_payment.sql");
 assert.match(newTrigger,/a\.verification_state='review_required'/);
 assert.match(newTrigger,/NEW.status::text = 'confirmed'/);
 assert.match(newTrigger,/WHEN is_guest AND a\.verification_state='review_required'/);
 assert.match(bookingRoute,/status: "pending"/);
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
