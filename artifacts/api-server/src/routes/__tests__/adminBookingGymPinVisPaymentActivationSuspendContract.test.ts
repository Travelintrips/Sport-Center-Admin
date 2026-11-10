import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Admin Lapangan direct Gym booking: payment -> PIN/VIS -> X904 -> suspend", () => {
  const bookingRoute = readFileSync(join(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const worker = readFileSync(join(process.cwd(), "src/services/x904NonmemberDailyAccessWorker.ts"), "utf8");
  const paymentGate = readFileSync(join(process.cwd(), "migrations/20261110_admin_booking_vis_payment_handover_gate.sql"), "utf8");
  const adminDetail = readFileSync(join(process.cwd(), "src/routes/waBookingsAdmin.ts"), "utf8");
  const adminUi = readFileSync(join(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");

  test("direct admin VIS creates pending verification, ordinary verified PIN keeps its existing path", () => {
    expect(bookingRoute).toContain("verifiedX904Identity.identityType === 'card' ? 'pending' : 'verified'");
    expect(bookingRoute).toContain("'pending')`");
    expect(bookingRoute).toContain("x904_verified_nonmember_identities");
    expect(bookingRoute).toContain("gym_x904_member_mapping");
  });

  test("confirmed payment does not itself verify physical handover on admin VIS", () => {
    expect(paymentGate).toContain("b.source=''admin''");
    expect(paymentGate).toContain("identity_type=''card''");
    expect(paymentGate).toContain("THEN ''pending'' ELSE ''verified''");
    expect(paymentGate).toContain("ADMIN_VIS_PAYMENT_TRIGGER_DRIFT");
    expect(paymentGate).toContain("1bef278ae9e71a7322776edc0b7408e1");
    expect(paymentGate).toContain("c4520dc7d76f5082b5f33b74dce13edf");
    expect(paymentGate).not.toMatch(/GRANT ALL|DISABLE ROW LEVEL SECURITY|DROP POLICY/i);
  });

  test("only authenticated operator can explicitly attest card handover", () => {
    const begin = bookingRoute.indexOf('router.post("/bookings/:bookingId/x904-admin-card-handover"');
    const end = bookingRoute.indexOf('router.post("/bookings/:bookingId/x904-vis-reserve"', begin);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const section = bookingRoute.slice(begin, end);
    expect(section).toContain("authMiddleware");
    expect(section).toContain("isOperationalBookingRole(principal)");
    expect(section).toContain("req.body?.identityChecked !== true");
    expect(section).toContain("req.body?.physicalCardHandedOver !== true");
    expect(section).toContain("b.source='admin'");
    expect(section).toContain("row.booking_status !== \"confirmed\"");
    expect(section).toContain("row.payment_status !== \"confirmed\"");
    expect(section).toContain("Number(matchingPayments.rows[0]?.n) !== 1");
    expect(section).toContain("row.expires_at");
    expect(section).toContain("row.activated_at != null");
    expect(section).toContain("s.observed_at>=now()-interval '5 minutes'");
    expect(section).toContain("u->>'group'='2'");
    expect(section).toContain("SET verification_state='verified'");
    expect(section).toContain("GYM_ADMIN_BOOKING_CARD_PHYSICAL_HANDOVER");
    expect(section).not.toContain("tx.insert(bookingsTable)");
    expect(section).not.toContain("tx.insert(paymentsTable)");
    expect(section).not.toContain("INSERT INTO sport_center.x904_user_commands");
  });

  test("worker only processes verified paid entitlements; admin cancellation never activates X904", () => {
    expect(worker).toContain("a.verification_state='verified'");
    expect(worker).toContain("a.payment_id IS NOT NULL");
    expect(worker).toContain("a.payment_status === \"confirmed\"");
    expect(worker).toContain('a.booking_source === "admin"');
    expect(worker).toContain('a.booking_status === "confirmed"');
    expect(worker).toContain('const commandType = shouldBeActive ? "ACTIVATE_USER" : "SUSPEND_USER"');
    expect(worker).toContain("readBackConfirmed");
    expect(worker).toContain("access_state='expired'");
    expect(worker).toContain("MAX_ATTEMPTS");
  });

  test("Admin Lapangan has one visible handover control and PIN/VIS payment/access state", () => {
    expect(adminDetail).toContain("adminGymAccess");
    expect(adminUi).toContain("handoverAdminGymVisMutation");
    expect(adminUi).toContain("/x904-admin-card-handover");
    expect(adminUi).toContain("physicalCardHandedOver: true, identityChecked: true");
    expect(adminUi).toContain("adminGymAccess.paymentStatus");
    expect(adminUi).toContain("adminGymAccess.accessState");
    expect(adminUi).toContain("Konfirmasi Penyerahan VIS");
    expect(adminUi).not.toContain("Konfirmasi Pembayaran dan Buka Pintu");
  });
});
