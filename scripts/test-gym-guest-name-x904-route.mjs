import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const r=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const service=r("artifacts/api-server/src/services/x904GymGuestNameRouting.ts");
const api=r("artifacts/api-server/src/routes/whatsapp.ts");
const ui=r("artifacts/sport-center/src/pages/wa/BookingForm.tsx");
const admin=r("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("match exact name uniquely; reject member, VIP PIN, card identities and unknown registry",()=>{
 assert.match(service,/regexp_replace\(trim\(display_name\)/);
 assert.match(service,/matched\.rows\.length === 0\) return \{ route: "visitor_card"/);
 assert.match(service,/matched\.rows\.length !== 1\) return \{ route: "staff_review"/);
 assert.match(service,/VIS_PINS\.has\(pin\) \|\| RESERVED_PINS\.has\(pin\)/);
 assert.match(service,/Number\(entry\.device_role\) !== 0/);
 assert.match(service,/gym_x904_member_mapping/);
 assert.match(service,/x904_verified_nonmember_identities/);
 assert.match(service,/verification_state='verified' AND revoked_at IS NULL/);
 assert.match(service,/route: "registered", userPin: pin/);
});
test("public preview reveals route but never machine PIN, UID or name",()=>{
 const preview=api.slice(api.indexOf('router.post("/wa/gym-name-route"'),api.indexOf('// POST /api/wa/booking —'));
 assert.match(preview,/resolveGymGuestName\(name\)/);
 assert.match(preview,/res\.status\(429\)/);
 assert.match(preview,/route: match\.route/);
 assert.doesNotMatch(preview,/res\.json\(\{[^}]*userPin/);
 assert.doesNotMatch(preview,/res\.json\(\{[^}]*deviceUid/);
 assert.match(preview,/Never send user_pin, UID/);
});
test("public PIN must match the registered name and never grants X904 by itself",()=>{
 const route=api.slice(api.indexOf('router.post("/wa/booking"'),api.indexOf('// GET /api/wa/status/:orderNumber'));
 assert.match(route,/guestSubmittedPin/);
 assert.match(route,/guestSubmittedPin !== guestNameRoute\.userPin/);
 assert.match(route,/guestSubmittedPin && guestNameRoute\?\.route !== "registered"/);
 assert.match(route,/resolveGymGuestName\(bookingCustomerName\)/);
 assert.match(route,/guestNameRoute\?\.route === "registered"/);
 assert.match(route,/guestNameRoute\?\.route === "visitor_card"/);
 assert.match(route,/Kartu VIS001–VIS006 menunggu pilihan dan penyerahan petugas/);
 assert.match(route,/if \(verifiedX904Identity\) \{/);
 assert.match(route,/const customer = publicGymGuest \? null : await ensureCustomer/);
 assert.match(route,/GYM_PUBLIC_GUEST_DUPLICATE_BOOKING/);
 assert.doesNotMatch(route,/ACTIVATE_USER|SUSPEND_USER/);
});
test("UI guides known name and unknown name to proper staff followup without PIN exposure",()=>{
 assert.match(ui,/Pencocokan Identitas Gym X904/);
 assert.match(ui,/\/api\/wa\/gym-name-route/);
 assert.match(ui,/guestIdentityRoute === "registered"/);
 assert.match(ui,/guestIdentityRoute === "visitor_card"/);
 assert.match(ui,/guestIdentityRoute === "staff_review"/);
 assert.match(ui,/petugas akan memilih kartu yang tersedia/i);
 assert.doesNotMatch(ui,/PIN Mesin X904 \(Opsional\)/);
 assert.match(ui,/requestedX904Pin: guestPin\.trim\(\)/);
 assert.match(ui,/id="guest-x904-pin"/);
 assert.match(admin,/Identitas X904 yang diajukan pengunjung/);
});

test("public name and PIN preview compares on server without returning machine PIN",()=>{
 const preview=api.slice(api.indexOf('router.post("/wa/gym-name-route"'),api.indexOf('// POST /api/wa/booking —'));
 assert.match(preview,/requestedX904Pin/);
 assert.match(preview,/pinMatch: submittedPin/);
 assert.match(preview,/submittedPin === match.userPin/);
 assert.match(ui,/form.customerName, guestPin/);
 assert.match(ui,/guestPinMatch === true/);
 assert.match(ui,/guestPinMatch === false/);
 assert.match(ui,/Identitas X904 ditemukan, tetapi belum diverifikasi sebagai nonmember/);
});
test("unverified nonmember inventory match is informational and never grants access",()=>{
 assert.match(service,/inventoryPinMatch = submittedPin \? submittedPin === pin : null/);
 assert.match(service,/route: "staff_review", userPin: null, deviceUid: null, displayName: null, inventoryPinMatch/);
 assert.match(ui,/Nama dan PIN cocok di mesin — perlu verifikasi petugas/);
 assert.match(api,/resolveGymGuestName\(name, submittedPin\)/);
});
