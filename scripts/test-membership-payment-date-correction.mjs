import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../artifacts/api-server/src/routes/bookings.ts', import.meta.url), 'utf8');
const endpoint = source.split('router.patch("/bookings/:id/dates"')[1]?.split('// POST /bookings/:id/fix-gym-people')[0];
assert.ok(endpoint, 'Expected date-correction endpoint');
assert.match(endpoint, /\.update\(membershipPaymentsTable\)\s*\/\/[^]*?\.set\(\{ paymentDate: paymentDate! \}\)/);
assert.doesNotMatch(endpoint, /\.update\(membershipPaymentsTable\)[^]*?\.set\(\{\s*confirmedAt: paymentTimestamp/);
assert.match(endpoint, /\.update\(paymentsTable\)[^]*?paidAt: paymentTimestamp/);
assert.match(endpoint, /\.update\(bookingsTable\)/);
console.log('PASS: membership payment-date correction preserves confirmation timestamps and avoids settlement rebuild trigger columns');
