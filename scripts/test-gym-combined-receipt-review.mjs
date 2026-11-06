import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../"+path, import.meta.url),"utf8");
const api=read("artifacts/api-server/src/routes/memberships.ts");
const schema=read("artifacts/api-server/migrations/20261106_gym_combined_receipt_review.sql");
const begin=api.indexOf('router.post("/memberships/admin-combined-receipt"');
const end=api.indexOf('// Admin-only, single-request registration',begin);
const route=api.slice(begin,end);

test("combined receipt is admin-only and always pending bank verification",()=>{
 assert.ok(begin>0&&end>begin);
 assert.match(route,/adminMiddleware/);
 assert.match(route,/authorizedGymPaymentRole\(req\)/);
 assert.match(route,/awaiting_bank_verification/);
 assert.doesNotMatch(route,/pushMembershipPaymentAsBankMutation|finalizeAdminGymPayment|ACTIVATE_USER|SUSPEND_USER|x904_automatic_entitlement_events/);
});
test("one incoming payment is split precisely and protected against replays",()=>{
 assert.match(route,/new Set<string>\(\)/);
 assert.match(route,/uniquePins.has\(pin\)/);
 assert.match(route,/items.reduce\(\(n,item\)=>n\+item.amount,0\) !== amount/);
 assert.match(route,/createHash\("sha256"\)/);
 assert.match(route,/WHERE reference=\$\{reference\} OR proof_sha256=\$\{digest\}/);
 assert.match(schema,/UNIQUE \(reference\)/);
 assert.match(schema,/UNIQUE \(proof_sha256\)/);
 assert.match(schema,/UNIQUE\(receipt_id,device_serial,user_pin\)/);
});
test("new member requires independently verified inventory and renewal requires matching owner",()=>{
 assert.match(route,/gym_x904_lan_users/);
 assert.match(route,/x904_verified_nonmember_identities/);
 assert.match(route,/gym_x904_member_mapping/);
 assert.match(route,/sport_center.sport_memberships/);
 assert.match(route,/status='awaiting_bank_verification'/);
});
test("never creates bank mutation, journal, confirmed membership, or door entitlement",()=>{
 assert.doesNotMatch(route,/INSERT INTO sport_center.bank_mutations/);
 assert.doesNotMatch(route,/INSERT INTO sport_center.sport_membership_payments/);
 assert.doesNotMatch(route,/UPDATE sport_center.sport_memberships/);
 assert.match(schema,/bank_mutation_id integer REFERENCES/);
 assert.match(schema,/status <> 'verified' OR/);
});

test("individual paid flows cannot reuse the same combined bank proof",()=>{
 assert.match(api,/async function assertProofNotCombinedReceipt\(proofBytes: Buffer\)/);
 assert.match(api,/SELECT to_regclass\('sport_center.gym_combined_receipts'\)/);
 assert.match(api,/WHERE proof_sha256=\$\{digest\} LIMIT 1/);
 const register=api.slice(api.indexOf('router.post("/memberships/admin-register-paid"'),api.indexOf('router.post("/memberships"',api.indexOf('router.post("/memberships/admin-register-paid"')));
 assert.match(register,/await assertProofNotCombinedReceipt\(proof.buffer\)/);
 const upload=api.slice(api.indexOf('router.post("/memberships/:id/admin-payment-proof-upload"'),api.indexOf('// Admin retry for an already-uploaded proof'));
 assert.match(upload,/await assertProofNotCombinedReceipt\(req.file.buffer\)/);
});

test("photo-only combined intake generates internal reference, never trusts a user bank reference",()=>{
 assert.match(route,/const reference = "SC-GYM-PROOF-" \+ digest.toUpperCase\(\)/);
 assert.doesNotMatch(route,/req.body\?\.reference/);
 assert.match(route,/internalReference:reference/);
 const ui=read("artifacts/sport-center/src/pages/admin/CheckoutForm.tsx");
 assert.doesNotMatch(ui,/combinedReference|payload.append\("reference"/);
 assert.match(ui,/Tidak perlu nomor referensi bank/);
 assert.match(ui,/disabled=\{combinedBusy \|\| !combinedProof\}/);
});

test("admin receipt review is read-only and lists allocations without granting access",()=>{
 const begin=api.indexOf('router.get("/memberships/admin-combined-receipts"');
 const end=api.indexOf('// Prevent reusing a shared receipt image',begin);
 const review=api.slice(begin,end);
 assert.ok(begin>0&&end>begin);
 assert.match(review,/adminMiddleware/);
 assert.match(review,/authorizedGymPaymentRole\(req\)/);
 assert.match(review,/allocation_sum/);
 assert.match(review,/Cache-Control","no-store"/);
 assert.doesNotMatch(review,/UPDATE |DELETE |INSERT INTO |ACTIVATE_USER|finalizeAdminGymPayment/);
 const ui=read("artifacts/sport-center/src/pages/admin/CheckoutForm.tsx");
 assert.match(ui,/Bukti gabungan tersimpan/);
 assert.match(ui,/loadCombinedReceipts\(\)/);
 assert.match(ui,/receipt.allocationSum!==receipt.amount/);
 assert.match(ui,/Belum boleh dinyatakan lunas sampai dana diterima/);
});

test("photo-approval is atomic, admin-only, audited and must not mint a second bank mutation",()=>{
 const begin=api.indexOf('router.post("/memberships/admin-combined-receipts/:id/approve-photo"');
 const end=api.indexOf('// Prevent reusing a shared receipt image',begin);
 const endpoint=api.slice(begin,end);
 assert.ok(begin>0&&end>begin);
 assert.match(endpoint,/adminMiddleware/);
 assert.match(endpoint,/acknowledgeNotBankVerified/);
 assert.match(endpoint,/await db.transaction\(async tx=>/);
 assert.match(endpoint,/FOR UPDATE/);
 assert.match(endpoint,/photo_approved/);
 assert.match(endpoint,/gym_combined_photo_approval_audit/);
 assert.match(endpoint,/x904_automatic_entitlement_events/);
 assert.match(endpoint,/gym_combined_receipt_allocations/);
 assert.match(endpoint,/alreadyApproved:!result.fresh/);
 assert.match(endpoint,/settlementProviderCode:"admin_photo_approval_not_bank_verified"/);
 assert.doesNotMatch(endpoint,/pushMembershipPaymentAsBankMutation\(/);
 assert.doesNotMatch(endpoint,/INSERT INTO sport_center.bank_mutations/);
});
test("admin photo approval requires explicit action and stored receipt, not re-upload",()=>{
 const ui=read("artifacts/sport-center/src/pages/admin/CheckoutForm.tsx");
 assert.match(ui,/approveCombinedPhoto\(receipt/);
 assert.match(ui,/Setujui Foto & Proses Membership/);
 assert.match(ui,/confirmPhoto:true,acknowledgeNotBankVerified:true/);
 assert.match(ui,/receipt.status==="awaiting_bank_verification"/);
 assert.match(ui,/acknowledgeNotBankVerified:true/);
});
