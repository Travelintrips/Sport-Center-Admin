import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const route = readFileSync(new URL('../artifacts/api-server/src/routes/gymX904Lan.ts', import.meta.url), 'utf8');
assert.match(route, /GYM_X904_LAN_INGEST_ENABLED/);
assert.match(route, /readAuthenticated/);
assert.match(route, /ON CONFLICT \(event_id\)/);
assert.match(route, /verifiedStored: true/);
assert.doesNotMatch(route, /CMD_DISABLEDEVICE|CMD_DELETE_USER|CMD_UNLOCK/);
console.log('PASS: X904 read-only LAN route guard contract');
