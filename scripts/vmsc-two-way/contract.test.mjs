import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const schema = readFileSync(new URL('../migrations/20261017_x904_vmsc_command_queue_dev.sql',import.meta.url),'utf8');
const guide = readFileSync(new URL('./README.md',import.meta.url),'utf8');
test('only read-only commands are allowed',()=>{
 assert.match(schema,/command_type IN \('device_info','clock_read'\)/);
 assert.doesNotMatch(schema,/unlock_door|set_user|delete_user|enroll_user|restart_device/);
});
test('durable idempotent receipts and expiry exist',()=>{
 assert.match(schema,/command_id uuid PRIMARY KEY/);
 assert.match(schema,/expires_at timestamptz NOT NULL/);
 assert.match(schema,/callback_received_at/);
 assert.match(guide,/A claim ACK is not a result ACK/);
});
