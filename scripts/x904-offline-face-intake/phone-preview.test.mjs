import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('./phone-preview.html', import.meta.url), 'utf8');
test('browser preview declares no network and no form destination', () => {
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/form-action 'none'/);
 assert.doesNotMatch(html,/<form\b|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|<iframe\b/i);
});
test('mobile preview rejects non-test PIN, caps source images, and compresses locally', () => {
 assert.match(html,/pin\.value!=='500'/);
 assert.match(html,/file\.size<100\|\|file\.size>50000/);
 assert.match(html,/STAGED_OFFLINE_ONLY/);
 assert.match(html,/createImageBitmap/);
});
