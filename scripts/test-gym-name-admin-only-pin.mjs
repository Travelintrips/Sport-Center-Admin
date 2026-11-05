import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const booking=read("artifacts/api-server/src/routes/whatsapp.ts");
const admin=read("artifacts/api-server/src/routes/waBookingsAdmin.ts");
const ui=read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("anonymous booking writes no X904 machine PIN or UID into public booking notes",()=>{
 const route=booking.slice(booking.indexOf('router.post("/wa/booking"'),booking.indexOf('// GET /api/wa/status/:orderNumber'));
 assert.match(route,/nama cocok dengan registry X904/);
 assert.doesNotMatch(route,/notes:[\s\S]*?"Gym mandiri; identitas mesin cocok: PIN "/);
});
test("anonymous status and WA token detail hide even legacy guest notes",()=>{
 const publicStatus=booking.slice(booking.indexOf('router.get("/wa/status/:orderNumber"'),booking.indexOf('// GET /api/wa/action/:token'));
 assert.match(publicStatus,/notes: booking\.source === "gym_public_guest" \? "Identitas X904 ditinjau petugas\." : booking\.notes/);
 const publicAction=booking.slice(booking.indexOf('router.get("/wa/action/:token"'),booking.indexOf('// POST /api/wa/action/:token'));
 assert.match(publicAction,/booking: booking\.source === "gym_public_guest"/);
 assert.match(publicAction,/\{ \.\.\.booking, notes: "Identitas X904 ditinjau petugas\." \}/);
});
test("matched identity returned only through guarded admin detail and explicitly unverified",()=>{
 const detail=admin.slice(admin.indexOf('router.get("/admin/wa-bookings/:orderNumber/detail"'),admin.indexOf('// ─── POST /api/admin/wa-bookings/:orderNumber/approve'));
 assert.match(detail,/adminMiddleware/);
 assert.match(detail,/resolveGymGuestName\(booking\.customerName\)/);
 assert.match(detail,/userPin: x904IdentityMatch\.userPin/);
 assert.match(detail,/deviceUid: x904IdentityMatch\.deviceUid/);
 assert.match(detail,/ownershipVerified: false/);
 assert.match(ui,/Hasil pencocokan identitas X904 \(khusus petugas\)/);
 assert.match(ui,/detail\.x904IdentityMatch\.userPin/);
 assert.match(ui,/Nama cocok, tetapi kepemilikan belum diverifikasi/);
});
