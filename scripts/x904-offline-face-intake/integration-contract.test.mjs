import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const load = (p) => readFile(new URL(p, root), 'utf8');
test('admin face preview has no dispatch, fetch or SDK references', async () => {
 const ui = await load('artifacts/sport-center/src/pages/admin/GymX904FaceOffline.tsx');
 assert.doesNotMatch(ui, /\bfetch\s*\(|axios|XMLHttpRequest|WebSocket|EventSource|sendBeacon|supabase\.|apiClient|x904_user_commands|CREATE_USER|UPDATE_USER|DELETE_USER|SUSPEND_USER|ACTIVATE_USER|SendUserFacePhoto/);
 assert.match(ui,/createImageBitmap/);
 assert.match(ui,/crypto\.subtle\.digest/);
 assert.match(ui,/STAGED_OFFLINE_ONLY/);
});
test('offline route stays inside AdminRouter and links from X904 admin', async()=>{
 const app=await load('artifacts/sport-center/src/App.tsx');
 const page=await load('artifacts/sport-center/src/pages/admin/GymX904.tsx');
 assert.match(app,/path="\/admin\/gym-x904\/face-offline" component=\{AdminRouter\}/);
 assert.match(app,/location === "\/admin\/gym-x904\/face-offline"/);
 assert.match(page,/href="\/admin\/gym-x904\/face-offline"/);
});
test('existing X904 executor command sets have no face dispatch',async()=>{
 const worker=await load('artifacts/api-server/src/services/x904AutomaticCommandWorker.ts');
 assert.doesNotMatch(worker,/SEND_FACE_PHOTO|SEND_USER_FACE|SendUserFacePhoto/);
 const routes=await Promise.all(['gymX904Integration','gymX904Events','gymX904Lan','gymX904Attested'].map(n=>load('artifacts/api-server/src/routes/'+n+'.ts')));
 for(const route of routes) assert.doesNotMatch(route,/SendUserFacePhoto|SEND_FACE_PHOTO|SEND_USER_FACE/);
});
