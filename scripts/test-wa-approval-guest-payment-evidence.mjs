import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const api=read("artifacts/api-server/src/routes/waBookingsAdmin.ts");
const ui=read("artifacts/sport-center/src/pages/admin/WaBookings.tsx");

test("admin detail loads only payment evidence associated with the booking",()=>{
  const detail=api.slice(api.indexOf('router.get("/admin/wa-bookings/:orderNumber/detail"'),
    api.indexOf('router.post("/admin/wa-bookings/:orderNumber/approve"'));
  assert.match(detail,/adminMiddleware/);
  assert.match(detail,/eq\(paymentsTable\.bookingId, booking\.id\)/);
  assert.match(detail,/proofUrl: paymentsTable\.proofUrl/);
  assert.match(detail,/status: paymentsTable\.status/);
  assert.match(detail,/ocrAmount: paymentsTable\.ocrAmount/);
  assert.match(detail,/payments,/);
  assert.doesNotMatch(detail,/update\(paymentsTable\)|insert\(paymentsTable\)|ACTIVATE_USER/);
});

test("public guest is not associated with a WA chat session just by phone",()=>{
  const detail=api.slice(api.indexOf('router.get("/admin/wa-bookings/:orderNumber/detail"'),
    api.indexOf('router.post("/admin/wa-bookings/:orderNumber/approve"'));
  assert.match(detail,/booking\.source === "gym_public_guest"\s*\?\s*\[\]/);
  assert.match(detail,/session: session\[0\] \?\? null/);
});

test("Gym detail shows read-only proof and status without assuming funds confirmed",()=>{
  assert.match(ui,/Bukti & status pembayaran/);
  assert.match(ui,/detail\.payments\.map/);
  assert.match(ui,/payment\.proofUrl/);
  assert.match(ui,/payment\.ocrAmount/);
  assert.match(ui,/Bukti\/OCR bukan konfirmasi dana masuk/);
  assert.match(ui,/rel="noopener noreferrer"/);
  assert.match(ui,/detail\.booking\.source !== "gym_public_guest" && \["pending_payment", "waiting_confirmation"\]/);
  const paid=api.slice(api.indexOf('router.post("/admin/wa-bookings/:orderNumber/paid"'),
    api.indexOf('router.post("/admin/wa-bookings/:orderNumber/resend"'));
  assert.match(paid,/booking\.source === "gym_public_guest"/);
  assert.match(paid,/res\.status\(409\)/);
});
