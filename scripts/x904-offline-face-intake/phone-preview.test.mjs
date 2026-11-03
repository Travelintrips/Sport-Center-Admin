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
 assert.match(html,/file\.size<100\|\|file\.size>20000000/);
 assert.match(html,/canvas\.toBlob/);
 assert.match(html,/blob\.size<=50000/);
 assert.match(html,/Ukuran asli/);
 assert.match(html,/Ukuran hasil/);
 assert.match(html,/STAGED_OFFLINE_ONLY/);
 assert.match(html,/createImageBitmap/);
});

test('manual attendance handoff stays local, PIN 500 synthetic only, and invalidates stale results',()=>{
 assert.match(html,/id="download" type="button" disabled/);
 assert.match(html,/a\.download='verify_biophoto_9_500\.jpg'/);
 assert.match(html,/URL\.createObjectURL\(stagedJPEG\)/);
 assert.match(html,/URL\.revokeObjectURL\(url\)/);
 assert.match(html,/if\(pin\.value!=='500'\|\|!stagedJPEG\|\|download\.disabled\)return/);
 assert.match(html,/generation!==currentGeneration/);
 assert.match(html,/photo\.addEventListener\('change',clearStaging\)/);
 assert.match(html,/pin\.addEventListener\('input',clearStaging\)/);
 assert.doesNotMatch(html,/<form\b|fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|<iframe\b|SendUserFacePhoto|UploadUserPhoto|x904_user_commands/i);
});
