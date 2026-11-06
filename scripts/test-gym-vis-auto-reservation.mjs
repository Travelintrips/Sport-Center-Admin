import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const migration=read("artifacts/api-server/migrations/20261106_gym_vis_card_reservations.sql");
const service=read("artifacts/api-server/src/services/x904GymVisitorCardReservations.ts");
const api=read("artifacts/api-server/src/routes/waBookingsAdmin.ts");
const payments=read("artifacts/api-server/src/routes/payments.ts");
const grantWorker=read("artifacts/api-server/src/services/x904NonmemberDailyAccessWorker.ts");
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
 assert.doesNotMatch(admin,/Alokasikan Kartu VIS Otomatis|autoAllocateVisMutation|visBankReference|visFundsChecked/);
 assert.match(admin,/sistem memproses alokasi kartu otomatis/);
 assert.match(publicApi,/visitorCard/);
 assert.match(ticket,/booking\.visitorCard\.code/);
 assert.match(ticket,/Kartu sudah dialokasikan otomatis/);
 assert.match(wa,/notifyGymVisitorCardReserved/);
 assert.match(wa,/Ambil kartu fisik/);
 const status=publicApi.slice(publicApi.indexOf('router.get("/wa/status/:orderNumber"'),publicApi.indexOf('// GET /api/wa/action/:token'));
 assert.match(status,/SELECT card_code,state/);
 assert.doesNotMatch(status,/visitorCard.*user_pin/);
});

test("one admin payment confirmation triggers idempotent physical VIS reservation and notification",()=>{
 assert.match(payments,/router\.patch\("\/payments\/:id", adminMiddleware/);
 assert.match(payments,/reserveVisitorCardAfterPaymentConfirmation/);
 assert.match(payments,/reserveVisAfterAdminPaymentConfirmation/);
 assert.match(payments,/notifyGymVisitorCardReserved/);
 assert.match(payments,/visReservation = status === "confirmed" && booking && payment/);
 assert.match(payments,/booking\.source !== "gym_public_guest"/);
 assert.match(payments,/payment\?\.paymentType === "dp"/);
 assert.match(payments,/paymentId: Number\(payment\.id\)/);
 const confirmationRoute=payments.slice(payments.indexOf('router.patch("/payments/:id"'));
 const metadataOnlyRoute=payments.slice(payments.indexOf('router.patch("/payments/:id/metadata"'),payments.indexOf('router.patch("/payments/:id"'));
 assert.match(confirmationRoute,/const visReservation = bookingForRepair/);
 assert.doesNotMatch(metadataOnlyRoute,/reserveVisitorCardAfterPaymentConfirmation\(/);
 assert.match(payments,/status: "needs_review"/);
 assert.match(service,/ADMINPAY-/);
 assert.match(service,/confirmedPaymentId: input\.paymentId/);
 assert.match(service,/internalManualReference/);
 const automatic=service.slice(service.indexOf("export async function reserveVisAfterAdminPaymentConfirmation"),service.indexOf("export async function collectReservedVisCard"));
 assert.doesNotMatch(automatic,/ACTIVATE_USER|x904_user_commands|x904_nonmember_daily_access/);
 assert.doesNotMatch(admin,/Alokasikan Kartu VIS Otomatis/);
});

test("paid VIS creates a held nonmember grant atomically; physical handover is the only unlock",()=>{
 const reserve=service.slice(service.indexOf("export async function autoReserveVisAfterFundsVerified"),service.indexOf("export async function reserveVisAfterAdminPaymentConfirmation"));
 assert.match(reserve,/INSERT INTO sport_center\.gym_vis_card_reservations/);
 assert.match(reserve,/INSERT INTO sport_center\.x904_nonmember_daily_access/);
 assert.match(reserve,/verification_state,access_state/);
 assert.match(reserve,/'pending','pending'/);
 assert.match(reserve,/AT TIME ZONE 'Asia\/Jakarta'/);
 assert.match(reserve,/RETURNING access_id/);
 assert.match(reserve,/machine_name/);
 const handover=service.slice(service.indexOf("export async function collectReservedVisCard"),service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(handover,/physicalCardHandedOver !== true/);
 assert.match(handover,/UPDATE sport_center\.x904_nonmember_daily_access/);
 assert.match(handover,/verification_state='verified'/);
 assert.match(handover,/verification_state='pending'/);
 assert.match(handover,/access_state='pending'/);
 assert.match(handover,/payment_id=/);
 assert.match(handover,/device_uid=/);
 assert.match(handover,/expires_at>now\(\)/);
 assert.match(handover,/vis_grant_not_ready/);
});

test("cancelled active visitor access still suspends, but cancelled pending access never activates",()=>{
 const worker=grantWorker;
 assert.match(worker,/a\.activated_at == null\) return/);
 assert.match(worker,/a\.booking_source !== "gym_public_guest" \|\| a\.booking_status === "confirmed"/);
 assert.match(worker,/a\.payment_status === "confirmed"/);
 assert.match(worker,/const targetGroup = shouldBeActive \? 1 : 2/);
 assert.match(worker,/const commandType = shouldBeActive \? "ACTIVATE_USER" : "SUSPEND_USER"/);
 // The cancellation guard must not precede a normal paid grant's end-of-life
 // suspend merely because the booking state has been revoked.
 const start=worker.indexOf("if (a.booking_source === \"gym_public_guest\"");
 const end=worker.indexOf("const pin = String(a.user_pin)",start);
 const guard=worker.slice(start,end);
 assert.match(guard,/a\.activated_at == null/);
 assert.doesNotMatch(guard,/booking_status !== "confirmed"\) return;/);
});

test("VIS activation worker requires collected reservation, leaves ordinary PINs and legacy cards alone",()=>{
 assert.match(grantWorker,/a\.booking_source === "gym_public_guest"/);
 assert.match(grantWorker,/Kartu VIS001–VIS006 menunggu pilihan/);
 assert.match(grantWorker,/gym_vis_card_reservations/);
 assert.match(grantWorker,/r\.state='collected'/);
 assert.match(grantWorker,/r\.collected_at IS NOT NULL/);
 assert.match(grantWorker,/r\.booking_id=/);
 assert.match(grantWorker,/r\.payment_id=/);
 assert.match(grantWorker,/r\.device_uid=/);
 assert.match(grantWorker,/if \(handover\.rows\.length !== 1\) return/);
 assert.match(grantWorker,/now\.getTime\(\) >= new Date\(String\(a\.expires_at\)\)\.getTime\(\)/);
 assert.match(grantWorker,/GYM_X904_NONMEMBER_ACCESS_ENABLED/);
 assert.match(grantWorker,/GYM_X904_USER_WRITE_ENABLED/);
 assert.match(grantWorker,/x904NonmemberOpeningHours/);
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
 const canonical=service.slice(service.indexOf("const recordedReferences = ["),service.indexOf("].map((value: unknown)",service.indexOf("const recordedReferences = [")));
 assert.match(canonical,/payment.reference_number/);
 assert.match(canonical,/payment.provider_trade_no/);
 assert.doesNotMatch(canonical,/payment.provider_reference|payment.merchant_trade_no/);
 assert.match(service,/recordedReferences\.length > 0 && !recordedReferences\.includes\(ref\)/);
 assert.match(service,/bank_reference_mismatch/);
 assert.match(service,/bank_reference_other_booking/);
 const otherPaymentCheck=service.slice(service.indexOf("const otherPayment ="),service.indexOf("if (otherPayment.rows.length)"));
 assert.match(otherPaymentCheck,/booking_id<>/);
 assert.doesNotMatch(otherPaymentCheck,/status::text=\x27confirmed\x27/);
});

test("manual admin verification is required, but bank API is not required for static Mandiri QRIS",()=>{
 const alloc=service.slice(service.indexOf("export async function autoReserveVisAfterFundsVerified"),service.indexOf("export async function collectReservedVisCard"));
 assert.match(alloc,/input\.officialFundsChecked !== true/);
 assert.match(alloc,/booking\.status !== "confirmed"/);
 assert.match(alloc,/status::text='confirmed'/);
 assert.match(alloc,/payment\.confirmed_at/);
 assert.match(alloc,/payment\.proof_url/);
 assert.match(alloc,/bank_reference_mismatch/);
 assert.match(alloc,/bank_reference_reused/);
 assert.match(alloc,/bank_reference_other_booking/);
 assert.doesNotMatch(alloc,/independent_bank_evidence_missing|bankEvidence\.rows|source_app|source_module/);
 assert.match(api,/payment: "manual_admin_confirmed"/);
 assert.match(api,/fundsConfirmedBy: adminEmail/);
 assert.match(api,/bankReference:/);
 assert.doesNotMatch(api,/payment: "official_bank_attested"/);
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

test("return requires verified PROD X904 read-back, not a DEV-only receipts table",()=>{
 const release=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.doesNotMatch(release,/x904_vmsc_command_receipts/);
 assert.match(release,/last_command\.command_type<>'SUSPEND_USER'/);
 assert.match(release,/last_command\.state<>'completed'/);
 assert.match(release,/readBackConfirmed/);
 assert.match(release,/afterGroup/);
 assert.match(release,/deviceUid/);
 assert.match(release,/last_command\.completed_at>latest\.observed_at/);
 assert.match(release,/created_at>=\$\{row\.collected_at\}/);
});

test("VIS cannot return to the available pool while the customer booking remains open",()=>{
 const release=service.slice(service.indexOf("export async function returnVerifiedVisCard"));
 assert.match(release,/b\.status::text AS booking_status/);
 assert.match(release,/booking_still_open/);
 assert.match(release,/\["completed","cancelled","refunded","expired","rejected"\]/);
});
