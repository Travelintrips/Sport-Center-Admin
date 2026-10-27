// Contract checks for manual-group queue and ACK. Read-only test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('./x904_group_ack_stage.sql');
const api=read('../artifacts/api-server/src/routes/gymX904Integration.ts');
const attestor=read('./x904-vmsc-group-uid-attestor.mjs');
const group=read('./x904-vmsc-group-executor-stage.ps1');
for(const op of ['SUSPEND_USER','ACTIVATE_USER']){
 assert.ok(sql.includes(op),'ACK missing '+op);
 assert.ok(api.includes(op),'API missing '+op);
 assert.ok(attestor.includes(op),'attestor missing '+op);
 assert.ok(group.includes(op),'executor missing '+op);
}
for(const token of ['p_lease_token','p_device_uid','p_group_after','p_count_after=p_count_before','leased_until>now()']){
 assert.ok(sql.includes(token),'ACK missing '+token);
}
assert.ok(api.includes('GYM_X904_MANUAL_ACCESS_ENABLED'));
assert.ok(group.includes('UID_ATTESTATION_REQUIRED'));
console.log('Manual X904 group API/attestor/ACK contract PASS (static only)');
