import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const migration=read("artifacts/api-server/migrations/20261106_gym_vis_card_reservations.sql");
const service=read("artifacts/api-server/src/services/x904GymVisitorCardReservations.ts");
const api=read("artifacts/api-server/src/routes/waBookingsAdmin.ts");
const publicApi=read("artifacts/api-server/src/routes/whatsapp.ts");
const ticket=read("artifacts/sport-center/src/pages/wa/BookingStatus.tsx");
const admin=read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");
const wa=read("artifacts/api-server/src/lib/notifications.ts");
const existingCheckout=read("artifacts/api-server/src/routes/whatsapp.ts");

test("hard uniqueness constraints prevent double allocations and reused bank references",()=>{
 assert.match(migration,/UNIQUE \(booking_id\)/);
 assert.match(migration,/UNIQUE \(funds_reference\)/);
 assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS gym_vis_res_card_active_uniq/);
 assert.match(migration,/WHERE state IN \('reserved','collected'\)/);
 assert.match(migration,/REVOKE ALL ON sport_center\.gym_vis_card_reservations FROM PUBLIC, anon, authenticated/);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 for(const code of ["VIS001","VIS002","VIS003","VIS004","VIS005","VIS006"])assert.ok(migration.includes(code));
});

test("only official verified funds plus confirmed unique payment can reserve a physical card",()=>{
 assert.match(service,/officialFundsChecked !== true/);
 assert.match(service,/pg_advisory_xact_lock\(90400661\)/);
 assert.match(service,/booking\.source !== "gym_public_guest" \|\| booking\.status !== "confirmed"/);
 assert.match(service,/Kartu VIS001–VIS006 menunggu pilihan/);
 assert.match(service,/enrolled\.rows\.length/);
 assert.match(service,/payment\.confirmed_at/);
 assert.match(service,/payment\.proof_url/);
 assert.match(service,/Number\(payment\.amount\) < Number\(booking\.amount\)/);
 assert.match(service,/paymentResult|payResult/);
 assert.match(service,/payment_ambiguous/);
 assert.match(service,/bank_reference_reused/);
 assert.match(service,/bank_reference_other_booking/);
 assert.match(service,/provider_trade_no/);
 assert.match(service,/x904_nonmember_daily_access/);
 assert.match(service,/access_state IN \('pending','active','review_required'\)/);
 assert.doesNotMatch(service,/ACTIVATE_USER|SUSPEND_USER|x904_user_commands/);
});

test("all six VIS codes use inventory-certified exact machine PIN, UID, role and label",()=>{
 const cards=[["VIS001","78","338"],["VIS002","90","339"],["VIS003","13","13"],["VIS004","17","17"],["VIS005","11","11"],["VIS006","15","15"]];
 for(const [code,pin,uid] of cards){
  assert.match(service,new RegExp("['\\x22]"+code+"['\\x22]"));
  assert.ok(service.includes("'"+code+"','"+pin+"',"+uid+")"));
 }
 assert.match(service,/u\.device_uid=c\.uid AND u\.device_role=0/);
 assert.match(service,/regexp_replace\(upper\(u\.display_name\)/);
 assert.match(service,/gym_x904_member_mapping/);
});

test("staff cannot assign without official bank attestation; public ticket is card-only",()=>{
 assert.match(api,/router\.post\("\/admin\/wa-bookings\/:orderNumber\/auto-allocate-vis", adminMiddleware/);
 assert.match(api,/officialFundsChecked: req\.body\?\.officialFundsChecked === true/);
 assert.match(api,/notifyGymVisitorCardReserved/);
 assert.match(admin,/Alokasikan Kartu VIS Otomatis/);
 assert.match(admin,/Saya sudah memeriksa dana benar-benar masuk/);
 assert.match(publicApi,/visitorCard/);
 assert.match(ticket,/booking\.visitorCard\.code/);
 assert.match(ticket,/Kartu sudah dialokasikan otomatis/);
 assert.match(wa,/notifyGymVisitorCardReserved/);
 assert.match(wa,/Ambil kartu fisik/);
 const status=publicApi.slice(publicApi.indexOf('router.get("/wa/status/:orderNumber"'),publicApi.indexOf('// GET /api/wa/action/:token'));
 assert.match(status,/SELECT card_code,state/);
 assert.doesNotMatch(status,/visitorCard.*user_pin/);
});

test("legacy VIS checkouts cannot reuse reserved visitor cards",()=>{
 assert.match(existingCheckout,/X904_VIS_CARD_RESERVED/);
 assert.match(existingCheckout,/pg_advisory_xact_lock\(90400661\)/);
 assert.match(existingCheckout,/to_regclass\('sport_center\.gym_vis_card_reservations'\)/);
 assert.match(existingCheckout,/state IN \('reserved','collected'\)/);
});

test("release requires physical return plus verified X904 status, not time-only expiry",()=>{
 assert.match(service,/physicalCardReturned !== true \|\| input\.x904ReadbackChecked !== true/);
 assert.match(service,/returnVerifiedVisCard/);
 assert.match(service,/access_state IN \('pending','active','review_required'\)/);
 assert.match(admin,/Kartu fisik sudah benar-benar kembali/);
 assert.match(api,/router\.post\("\/admin\/wa-bookings\/:orderNumber\/return-vis", adminMiddleware/);
 assert.doesNotMatch(migration,/CREATE TRIGGER|AFTER.*UPDATE/i);
});
