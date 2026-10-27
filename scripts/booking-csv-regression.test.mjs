import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Static safety guards only. Real finance totals require payment-ledger E2E.
const source = readFileSync("artifacts/api-server/src/routes/dashboard.ts", "utf8");
const route = source.slice(source.indexOf('router.get("/admin/bookings/export"'));

test("export supports booking date versus payment date and WIB boundaries", () => {
  assert.match(route, /dateBasis === "payment"/);
  assert.match(route, /startDate/);
  assert.match(route, /endDate/);
  assert.match(route, /Asia\/Jakarta/);
  assert.match(route, /b\.bookingDate/);
});
test("booking-date export excludes zero-price member usage", () => {
  assert.match(route, /Number\(b\.totalPrice\) > 0/);
});
test("payment-date export records confirmed payments individually at actual amount", () => {
  assert.match(route, /if \(p\.status !== "confirmed"\) continue/);
  assert.match(route, /p\.amount, b\.status/);
  assert.match(route, /p\.paymentType \?\? "full_payment"/);
  assert.match(route, /p\.id, b\.groupRef/);
  assert.match(route, /for \(const p of payments\)/);
  assert.doesNotMatch(route, /rows\.push\(csvRow\(\[.*?b\.totalPrice, b\.status/s);
});
test("group booking total is metadata, never booked as paid receipt", () => {
  assert.match(route, /everyBooking\.filter\(\(item\) => item\.groupRef === b\.groupRef\)/);
  assert.match(route, /p\.amount, b\.status/);
});
test("corporate invoice emits one paid invoice receipt, not one receipt per item", () => {
  assert.match(route, /invoice\.status !== "paid"/);
  assert.match(route, /invoicedBookings\.has\(id\)/);
  assert.match(route, /companyInvoiceItemsTable/);
});
test("CSV distinguishes payment type, payment ID and full booking amount", () => {
  assert.match(route, /Payment Date,Payment Type,Payment ID,Group Ref,Booking Total/);
  assert.match(route, /formatCreatedAtWib/);
});
