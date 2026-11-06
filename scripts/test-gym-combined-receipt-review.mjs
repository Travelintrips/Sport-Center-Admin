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
