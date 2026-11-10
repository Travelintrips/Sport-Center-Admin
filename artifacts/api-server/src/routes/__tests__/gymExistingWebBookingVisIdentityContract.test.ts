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

  test("admin card booking reuses an identical paid web visit rather than duplicating payment", () => {
    const start = bookings.indexOf("// Staff must reuse an already paid web Gym booking");
    const end = bookings.indexOf("let verifiedX904Identity", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const guard = bookings.slice(start, end);
    expect(guard).toContain('req.body.x904IdentityType === "card"');
    expect(guard).toContain("b.customer_phone=");
    expect(guard).toContain("upper(btrim(b.customer_name))");
    expect(guard).toContain("b.status::text='confirmed'");
    expect(guard).toContain("p.status::text='confirmed'");
    expect(guard).toContain('"EXISTING_PAID_GYM_BOOKING"');
    expect(guard).toContain("existingBookingId:");
  });

  test("existing booking reservation reuses server-verified confirmed payment, never field-staff bank attestation", () => {
    const start = bookings.indexOf('router.post("/bookings/:bookingId/x904-vis-reserve"');
    const end = bookings.indexOf('router.post("/bookings", async', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const route = bookings.slice(start, end);
    expect(route).toContain("isOperationalBookingRole(principal.role)");
    expect(route).toContain("req.body?.identityChecked !== true");
    expect(route).not.toContain("req.body?.officialFundsChecked !== true");
    expect(route).not.toContain("req.body?.officialBankReference");
    expect(route).toContain('eq(paymentsTable.status, "confirmed")');
    expect(route).toContain("confirmedPayments.length !== 1");
    expect(route).toContain("confirmedPaymentId,");
    expect(route).toContain("ADMINPAY-");
    expect(route).toContain("bankSettlementIndependentlyChecked: false");
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

  test("field operator VIS UI asks identity only, without fake bank statement attestation", () => {
    const ui = readFileSync(join(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");
    expect(ui).toContain("Sistem membaca pembayaran yang sudah dikonfirmasi");
    expect(ui).toContain("Status pembayaran terkonfirmasi bukan bukti settlement bank");
    expect(ui).not.toContain("visOfficialReference");
    expect(ui).not.toContain("visFundsChecked");
    expect(ui).toContain("identityChecked: visIdentityChecked");
    expect(ui).toContain("disabled={!visIdentityChecked || assignExistingWebVisMutation.isPending}");
  });

  test("worker never bypasses physical handover for web VIS", () => {
    expect(worker).toContain('a.booking_source === "web"');
    expect(worker).toContain("r.state='collected' AND r.collected_at IS NOT NULL");
    expect(worker).toContain("if (handover.rows.length !== 1) return");
    expect(monitoring).toContain("['gym_public_guest', 'web']");
  });
});
