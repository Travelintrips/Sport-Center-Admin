import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src=readFileSync('artifacts/api-server/src/routes/gymX904Integration.ts','utf8');
const endpoint=src.split('router.post("/admin/gym-x904/vis006-nonfinancial-test"')[1]?.split('export default router;')[0];
assert.ok(endpoint,'VIS006 endpoint must exist');
for(const required of ['GYM_X904_VIS006_NONFINANCIAL_TEST_ENABLED','GYM_X904_NONMEMBER_ONLY_PIN','confirmPin!=="15"','user_pin=\'15\'','expectedUid:15','expectedName:"VIS 006"','readBackConfirmed','FRESH_SNAPSHOT_OR_STATE_REQUIRED','pg_advisory_xact_lock','ON CONFLICT (idempotency_key) DO NOTHING']) assert.ok(endpoint.includes(required),`missing guard: ${required}`);
for(const forbidden of ['sport_payments','sport_bookings','membership_payments','INSERT INTO sport_center.accounting']) assert.ok(!endpoint.includes(forbidden),`unexpected financial mutation: ${forbidden}`);
console.log('PASS VIS006 endpoint guard and no-financial-write contract');
