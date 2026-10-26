import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Static contract guards: prevent known export regressions. These are NOT production E2E tests.
const source = readFileSync("artifacts/api-server/src/routes/dashboard.ts", "utf8");
const route = source.slice(source.indexOf('router.get("/admin/bookings/export"'));

test("export honors selected date basis and inclusive period", () => {
  assert.match(route, /dateBasis === "payment"/);
  assert.match(route, /startDate/);
  assert.match(route, /endDate/);
  assert.match(route, /b\.bookingDate/);
  assert.match(route, /paymentDate\(b\)/);
});
test("positive-price filter applies before both date modes", () => {
  const filterIndex = route.indexOf("Number(b.totalPrice) > 0");
  const modeIndex = route.indexOf("if (paymentBasis)");
  assert.ok(filterIndex > 0 && filterIndex < modeIndex);
});
test("group payments propagate to every member; no group collapse", () => {
  assert.match(route, /paymentDateByGroup/);
  assert.match(route, /b\.groupRef/);
  assert.match(route, /paymentsTable/);
  assert.match(route, /p\.status !== "confirmed"/);
  assert.doesNotMatch(route, /new Set\(bookings\.map\(\(b\) => b\.groupRef/);
});
test("corporate invoices require paid status and support linked invoice items", () => {
  assert.match(route, /companyInvoiceItemsTable/);
  assert.match(route, /invoiceIdByBooking/);
  assert.match(route, /invoice\?\.status === "paid"/);
});
test("CSV header matches row count and includes payment date", () => {
  assert.match(route, /Admin Notes,Created At,Payment Date/);
  assert.match(route, /paymentBasis \? paymentDate\(b\) : ""/);
  assert.match(route, /bookings\.map\(\(b\) =>/);
});
