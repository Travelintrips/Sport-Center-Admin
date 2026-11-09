import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym paid web booking identity and VIS handoff regression", () => {
  const bookings = readFileSync(join(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const cards = readFileSync(join(process.cwd(), "src/services/x904GymVisitorCardReservations.ts"), "utf8");
  const worker = readFileSync(join(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");
  const monitoring = readFileSync(join(process.cwd(), "src/routes/waBookingsAdmin.ts"), "utf8");

  test("staff who books from web is recorded as operator, never silently as customer", () => {
    expect(bookings).toContain("const staffPersonalBooking = isAdminRequest && !isCompanyBilling && !isPendingCompany");
    expect(bookings).toContain("const effectiveCustomerId = staffPersonalBooking");
    expect(bookings).toContain("bookedByUserId: loggedInUserId");
    expect(bookings).toContain('selectedCustomer.role !== "customer"');
    expect(bookings).toContain('eq(usersTable.role, "customer")');
  });

  test("existing booking reservation requires authenticated staff, a confirmed booking and independent funds and identity checks", () => {
    const start = bookings.indexOf('router.post("/bookings/:bookingId/x904-vis-reserve"');
    const end = bookings.indexOf('router.post("/bookings", async', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const route = bookings.slice(start, end);
    expect(route).toContain("isOperationalBookingRole(principal.role)");
    expect(route).toContain("req.body?.identityChecked !== true");
    expect(route).toContain("req.body?.officialFundsChecked !== true");
    expect(route).toContain('booking.source !== "web"');
    expect(route).toContain('booking.status !== "confirmed"');
    expect(route).toContain("autoReserveVisAfterFundsVerified");
    expect(route).toContain("allowWebBooking: true");
    expect(route).not.toContain("tx.insert(bookingsTable)");
    expect(route).not.toContain("tx.insert(paymentsTable)");
    expect(route).not.toContain("ACTIVATE_USER");
  });

  test("web booking VIS uses same atomic reservation, payment proof and physical inventory guards", () => {
    expect(cards).toContain('const existingWebGuest = input.allowWebBooking === true && booking.source === "web"');
    expect(cards).toContain('"booking_day_closed"');
    expect(cards).toContain('SELECT pg_advisory_xact_lock(90400661)');
    expect(cards).toContain('"payment_ambiguous"');
    expect(cards).toContain('String(payment.proof_url ?? "")');
    expect(cards).toContain('"vis_pool_exhausted"');
    expect(cards).toContain("verification_state,access_state)");
    expect(cards).toContain("'pending','pending'");
  });

  test("worker never bypasses physical handover for web VIS", () => {
    expect(worker).toContain('a.booking_source === "web"');
    expect(worker).toContain("r.state='collected' AND r.collected_at IS NOT NULL");
    expect(worker).toContain("if (handover.rows.length !== 1) return");
    expect(monitoring).toContain("['gym_public_guest', 'web']");
  });
});
