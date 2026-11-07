import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const api=read("artifacts/api-server/src/routes/waBookingsAdmin.ts");
const ui=read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("WA Approval list admits exactly existing WA sources and Gym guest, with safe filters", () => {
  const list=api.slice(api.indexOf('router.get("/admin/wa-bookings"'),api.indexOf('router.get("/admin/wa-bookings/:orderNumber/detail"'));
  for(const source of ['"whatsapp_chat"','"whatsapp"','"gym_public_guest"']) assert.ok(list.includes('eq(bookingsTable.source, '+source+')'));
  assert.match(list,/source === "wa"/);
  assert.match(list,/source === "gym_public_guest"/);
  assert.match(list,/where\(and\(\.\.\.conditions\)\)/);
  assert.match(ui,/params\.set\("source", sourceFilter\)/);
  assert.match(ui,/Gym Mandiri/);
});

test("new guest entries cannot use unverified one-click Lunas even by direct API call",()=>{
  const paid=api.slice(api.indexOf('router.post("/admin/wa-bookings/:orderNumber/paid"'),api.indexOf('router.post("/admin/wa-bookings/:orderNumber/resend"'));
  assert.match(paid,/booking\.source === "gym_public_guest"/);
  assert.match(paid,/res\.status\(409\)/);
  assert.ok(paid.indexOf('booking.source === "gym_public_guest"') < paid.indexOf('db.update(paymentsTable)'));
  assert.match(ui,/b\.source !== "gym_public_guest" && \["pending_payment", "waiting_confirmation"\]/);
  assert.match(ui,/detail\.booking\.source !== "gym_public_guest" && \["pending_payment", "waiting_confirmation"\]/);
  assert.match(ui,/\/admin\/bookings\?search=/);
});

test("existing WA administration actions are retained, Gym X904 commands are untouched",()=>{
  for(const action of ["approve","reject","paid","resend"])assert.ok(api.includes('/admin/wa-bookings/:orderNumber/'+action));
  const monitoring=api.slice(api.indexOf("router.get('/admin/wa-bookings/:orderNumber/x904-monitoring'"),api.indexOf("export default router;"));
  assert.match(monitoring,/SELECT command_id,command_type,state/);
  assert.doesNotMatch(monitoring,/INSERT INTO sport_center\.x904_user_commands|UPDATE sport_center\.x904_user_commands|enqueue.*command/i);
});
