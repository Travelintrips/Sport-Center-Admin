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
 const allocateOnly=service.slice(service.indexOf("export async function autoReserveVisAfterFundsVerified"),service.indexOf("export async function returnVerifiedVisCard"));
 assert.doesNotMatch(allocateOnly,/ACTIVATE_USER|SUSPEND_USER|x904_user_commands/);
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


test("VIS return checks unresolved X904 grants across all bookings for the physical PIN",()=>{
 const returnMethod=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(returnMethod,/WHERE device_serial='TDBD234200545'/);
 assert.match(returnMethod,/AND user_pin=\$\{String\(row\.user_pin\)\}/);
 assert.match(returnMethod,/access_state IN \('pending','active','review_required'\)/);
 assert.doesNotMatch(returnMethod,/WHERE booking_id=\$\{Number\(row\.booking_id\)\}/);
});

test("canonical bank payment reference cannot be contradicted by staff input",()=>{
 assert.match(service,/proof_url,confirmed_at,reference_number,provider_reference,provider_trade_no,merchant_trade_no/);
 assert.match(service,/const recordedReferences = \[/);
 assert.match(service,/recordedReferences\.length > 0 && !recordedReferences\.includes\(ref\)/);
 assert.match(service,/bank_reference_mismatch/);
 assert.match(service,/bank_reference_other_booking/);
});

test("independent bank attestation is required before any VIS allocation",()=>{
 assert.match(service,/independent_bank_evidence_missing/);
 assert.match(service,/matched_payment_id=\$\{Number\(payment\.id\)\}/);
 assert.match(service,/credit_amount>=\$\{Number\(booking\.amount\)\}/);
 assert.match(service,/provider_order_id/);
 assert.match(service,/status::text='auto_matched'/);
 assert.match(service,/source_app/);
 assert.match(service,/source_module/);
 assert.match(service,/provider_name/);
 assert.match(service,/NOT IN \('','manual'\)/);
 assert.match(service,/bankEvidence\.rows\.length !== 1/);
});

test("VIS release requires fresh actual device snapshot with suspended group and no later commands",()=>{
 const release=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(release,/gym_x904_access_snapshots/);
 assert.match(release,/observed_at >= now\(\)-interval '10 minutes'/);
 assert.match(release,/observed_at >= \$\{row\.collected_at\}/);
 assert.match(release,/jsonb_array_elements\(users\)/);
 assert.match(release,/u->>'group'='2'/);
 assert.match(release,/u->>'role'='0'/);
 assert.match(release,/x904_user_commands/);
 assert.match(release,/cmd\.created_at>latest\.observed_at/);
 assert.match(release,/x904_readback_missing/);
 assert.match(release,/access_state IN \('pending','active','review_required'\)/);
});

test("physical handover is required before VIS can be returned or reused",()=>{
 const handover=service.slice(service.indexOf("export async function collectReservedVisCard"),service.indexOf("export async function returnVerifiedVisCard"));
 const release=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(handover,/physicalCardHandedOver !== true/);
 assert.match(handover,/state='collected',collected_at=now\(\)/);
 assert.match(handover,/row\.booking_status !== "confirmed" \|\| row\.payment_status !== "confirmed"/);
 assert.match(handover,/vis_payment_or_booking_changed/);
 assert.match(release,/row\.state !== "collected" \|\| !row\.collected_at/);
 assert.match(release,/observed_at >= \$\{row\.collected_at\}/);
 assert.match(api,/\/admin\/wa-bookings\/:orderNumber\/collect-vis/);
 assert.match(admin,/Tandai Kartu Sudah Diambil/);
 assert.match(admin,/detail\.visCardReservation\?\.state === "collected"/);
});

test("post-handover machine commands demand verified final suspend receipt",()=>{
 const release=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(release,/x904_vmsc_command_receipts/);
 assert.match(release,/last_command\.command_type<>'SUSPEND_USER'/);
 assert.match(release,/last_command\.state<>'completed'/);
 assert.match(release,/receipt\.verified=true/);
 assert.match(release,/receipt\.callback_received_at<=latest\.observed_at/);
 assert.match(release,/created_at>=\$\{row\.collected_at\}/);
});

test("VIS cannot return to the available pool while the customer booking remains open",()=>{
 const release=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(release,/b\.status::text AS booking_status/);
 assert.match(release,/booking_still_open/);
 assert.match(release,/\["completed","cancelled","refunded","expired","rejected"\]/);
});
