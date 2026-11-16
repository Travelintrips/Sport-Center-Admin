import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
const multi = route.split('router.post("/bookings/admin-multi-schedule", adminMiddleware')[1]?.split('// POST /bookings/recurring/check')[0] ?? "";

describe("admin multi-schedule booking contract", () => {
  it("uses one admin-only endpoint without changing legacy recurring route", () => {
    expect(multi).toContain('verifyToken(token)');
    expect(multi).toContain('identity.role === "customer"');
    expect(route).toContain('router.post("/bookings/recurring/check"');
    expect(route).toContain('router.post("/bookings/recurring",');
  });
  it("rejects invalid count, unsupported money flows and event membership", () => {
    expect(multi).toContain('rawSessions.length < 2 || rawSessions.length > 52');
    expect(multi).toContain('req.body.downPaymentAmount != null');
    expect(multi).toContain('req.body.bookingType === "event"');
    expect(multi).toContain('facility.bookingMode === "walk_in"');
  });
  it("rejects overlap within the cart and rechecks occupied and blocked slots", () => {
    expect(multi).toContain('minute(first.startTime) < minute(second.startTime)');
    expect(multi).toContain('blockedSchedulesTable');
    expect(multi).toContain('INACTIVE_STATUSES.includes(b.status)');
  });
  it("locks in a single database transaction and generates order codes before acquiring pool connection", () => {
    expect(multi).toContain('await generateBookingOrderNumber()');
    expect(multi.indexOf('await generateBookingOrderNumber()')).toBeLessThan(multi.indexOf('db.transaction(async (tx)'));
    expect(multi).toContain('pg_advisory_xact_lock');
    expect(multi).toContain('tx.insert(bookingGroupsTable)');
    expect(multi).toContain('tx.insert(bookingsTable)');
  });

  it("stores facility per session and locks each court/date separately", () => {
    expect(multi).toContain("facilityId: item?.facilityId == null ? facilityId : Number(item.facilityId)");
    expect(multi).toContain("facilityById.get(session.facilityId)");
    expect(multi).toContain("first.facilityId === second.facilityId");
    expect(multi).toContain("item.facilityId + \":\" + item.date");
    expect(multi).toContain("eq(bookingsTable.facilityId, session.facilityId)");
    expect(multi).toContain("eq(blockedSchedulesTable.facilityId, session.facilityId)");
    expect(multi).toContain("facilityId: item.facilityId, bookingDate: item.date");
    expect(multi).toContain("broadcastAvailabilityChange(item.facilityId, item.date)");
  });
  it("preserves old single-facility clients when per-session facilityId is omitted", () => {
    expect(multi).toContain("item?.facilityId == null ? facilityId");
    expect(multi).toContain("facilityId: rawFacilityId");
  });
  it("creates a single group and reserves payment notification until settlement", () => {
    expect(multi).toContain('groupRef, customerPhone, customerName');
    expect(multi).toContain('adminPaymentChoice !== "paid"');
    expect(multi).toContain('notifyAdminBookingReport');
    expect(multi).toContain('totalBookings: created.length');
  });
});
