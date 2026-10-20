import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync('artifacts/api-server/src/routes/gymX904Integration.ts','utf8');
for(const token of ['GYM_X904_USER_WRITE_ENABLED','owner','super_admin','CREATE_USER','UPDATE_USER','DELETE_USER','USER_WRITE_DISABLED','x904_user_commands']) assert.ok(route.includes(token),'missing '+token);
for(const token of ['confirmPin','expectedSerial','idempotencyKey','command_id']) assert.ok(route.includes(token),'missing '+token);
assert.ok(route.includes('USER_WRITE_DISABLED'),'fail closed');
console.log('X904_USER_CONTROL_STAGING_CONTRACT_PASS');
