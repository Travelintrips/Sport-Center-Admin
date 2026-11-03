import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validateOfflineFace } from './face-intake.mjs';

const filename = 'verify_biophoto_9_500.jpg';
const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888888' } }).jpeg().toBuffer();
const check = (changes = {}) => validateOfflineFace({ pin: '500', filename, bytes: jpg, ...changes });

test('synthetic JPEG accepted strictly for offline staging', async () => {
  const r = await check();
  assert.equal(r.status, 'STAGED_OFFLINE_ONLY');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.autoDispatch, false);
  assert.equal(r.deviceWrite, false);
});
test('reject every other PIN', async () => assert.equal((await check({ pin: '501' })).reason, 'TEST_PIN_ONLY'));
test('reject other filename', async () => assert.equal((await check({ filename: 'selfie.jpg' })).reason, 'FILENAME_MISMATCH'));
test('reject larger than 50000 bytes', async () => assert.equal((await check({ bytes: Buffer.alloc(50001) })).reason, 'SIZE_INVALID'));
test('reject invalid magic', async () => assert.equal((await check({ bytes: Buffer.alloc(100) })).reason, 'NOT_JPEG'));
test('reject fake JPEG with header/footer only', async () => {
  const fake = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(120), Buffer.from([255, 217])]);
  assert.equal((await check({ bytes: fake })).reason, 'DECODE_FAILED');
});
