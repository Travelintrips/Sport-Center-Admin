// Static regression checks for the staged group executor. No device writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./x904-vmsc-group-executor-stage.ps1',import.meta.url),'utf8');
for(const token of [
  'UID_ATTESTATION_REQUIRED','uidAttestedByWorker',
  'SUSPEND_GROUP_CAN_UNLOCK','SSR_GetUnLockGroup',
  'SetUserGroup','GetUserGroup','GROUP_READBACK_MISMATCH',
  'Global\\X904_VMSC_PRIMARY_SYNC','MANUAL_ACCESS_DISABLED',
  'SUSPEND_USER','ACTIVATE_USER'
]) assert.ok(source.includes(token), 'Missing safety check: '+token);
assert.equal((source.match(/SetUserGroup/g)||[]).length,1,'Unexpected second group write path');
assert.equal((source.match(/GetUserGroup\(1,/g)||[]).length,2,'Expected only before/after SDK group reads');
assert.equal((source.match(/\$groupReadAttempt=1;\$groupReadAttempt -le 3;/g)||[]).length,2,'Both group reads require bounded 3-attempt retries');
assert.ok(source.includes("Require $beforeOk 'GROUP_READ_FAILED'"),'Never write after failed pre-read');
assert.ok(source.includes("Require ($afterOk -and $after -eq $desired) 'GROUP_READBACK_MISMATCH'"),'Never ACK without verified group readback');
assert.ok(source.indexOf('UID_ATTESTATION_REQUIRED') < source.indexOf('SetUserGroup'),'UID attestation must precede write');
assert.ok(source.indexOf('SUSPEND_GROUP_CAN_UNLOCK') < source.indexOf('SetUserGroup'),'Unlock policy must precede write');
console.log('X904 group executor static safety checks PASS');
