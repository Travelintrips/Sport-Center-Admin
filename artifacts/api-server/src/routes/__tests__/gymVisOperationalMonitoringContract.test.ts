import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym VIS operational monitoring contract", () => {
  const api = readFileSync(join(process.cwd(),"src/routes/waBookingsAdmin.ts"),"utf8");
  const bookings = readFileSync(join(process.cwd(),"src/routes/bookings.ts"),"utf8");
  const ui = readFileSync(join(process.cwd(),"../sport-center/src/pages/admin/Bookings.tsx"),"utf8");
  const waUi = readFileSync(join(process.cwd(),"../sport-center/src/pages/admin/WaBookings.tsx"),"utf8");

  test("admin monitoring exposes lifecycle proof without changing X904", () => {
    expect(api).toContain("/admin/wa-bookings/:orderNumber/x904-monitoring");
    expect(api).toContain("accessId:Number(row.access_id)");
    expect(api).toContain("readBackConfirmed");
    expect(api).toContain("returnReady");
    expect(api).toContain("snapshot_stale");
    expect(api).toContain("available");
  });

  test("all six paid VIS preserve active ACK and require secure return without fake handover", () => {
    const service = readFileSync(join(process.cwd(),"src/services/x904GymVisitorCardReservations.ts"),"utf8");
    const worker = readFileSync(join(process.cwd(),"src/services/x904NonmemberDailyAccessWorker.ts"),"utf8");
    for (const code of ["VIS001","VIS002","VIS003","VIS004","VIS005","VIS006"]) {
      expect(api).toContain(code);
      expect(service).toContain(code);
    }
    expect(worker).toContain("a.identity_type === \"card\"");
    expect(worker).toContain("r.state='reserved'");
    expect(worker).toContain("r.funds_verified_at IS NOT NULL");
    expect(api).toContain("paidAutoVisReturn");
    expect(api).toContain("latestCommand?.command_type === 'SUSPEND_USER'");
    expect(service).toContain("row.state === \"reserved\" && !row.collected_at");
    expect(service).toContain("vis_suspend_proof_missing");
    expect(service).toContain("physicalCardReturned");
    expect(ui).toContain('gymVisReservation.state === "reserved" && (gymVisAccess?.accessState === "active" || gymVisAccess?.returnReady)');
  });

  test("Booking Admin shows one-place lifecycle, pool and guarded return", () => {
    expect(ui).toContain("Pool VIS / X904");
    expect(ui).toContain("Access ID");
    expect(ui).toContain("ACK / read-back");
    expect(ui).toContain("Kembalikan Kartu ke Pool");
    expect(ui).toContain("gymVisAccess?.returnReady");
    expect(ui).toContain("visPhysicalReturned");
  });

  test("existing web booking VIS assignment verifies current staff session, not just token role", () => {
    const start = bookings.indexOf('router.post("/bookings/:bookingId/x904-vis-reserve"');
    const end = bookings.indexOf('router.post("/bookings", async', start);
    expect(start).toBeGreaterThan(-1);
    const route = bookings.slice(start, end);
    expect(route).toContain('authMiddleware, async (req, res)');
    expect(route).toContain('isOperationalBookingRole(principal.role)');
    expect(route).not.toContain('req.body?.officialFundsChecked !== true');
    expect(route).toContain('eq(paymentsTable.status, "confirmed")');
    expect(route).toContain("confirmedPayments.length !== 1");
    expect(route).toContain("confirmedPaymentId,");
    expect(route).not.toContain('ACTIVATE_USER');
  });

  test("web Gym booking and public guest both poll authoritative VIS monitoring", () => {
    const queryStart = ui.indexOf('const { data: gymX904Monitoring');
    const queryEnd = ui.indexOf('const gymVisReservation', queryStart);
    const monitoringQuery = ui.slice(queryStart, queryEnd);
    expect(queryStart).toBeGreaterThan(-1);
    expect(monitoringQuery).toContain('booking.source === "gym_public_guest"');
    expect(monitoringQuery).toContain('booking.source === "web"');
    expect(monitoringQuery).toContain('refetchInterval: 15000');
    expect(monitoringQuery).toContain('refetchOnMount: "always"');
    expect(ui).toContain('gymX904Monitoring?.reservation ?? gymGuestAdminDetail?.visCardReservation');
    expect(ui).toContain('invalidateQueries({ queryKey: ["admin-gym-x904-monitoring", booking.orderNumber] })');
    expect(api).toContain("['gym_public_guest', 'web'].includes");
  });

  test("monitoring errors fail closed with retry; past-date web VIS reservation is hidden", () => {
    expect(ui).toContain('gymX904MonitoringFailed');
    expect(ui).toContain('Coba lagi monitoring VIS');
    expect(ui).toContain('Jangan serahkan atau menetapkan kartu sebelum status terbaru terbaca');
    expect(ui).toContain('new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })');
    expect(ui).toContain('booking.status === "confirmed" && !gymVisReservation && !gymX904MonitoringFailed');
    expect(ui).not.toContain('identitas Fandy/pengunjung');
  });

  test("PIN approval remains explicit staff attestation and never payment-only", () => {
    expect(waUi).toContain("Saya telah memeriksa langsung identitas pengunjung");
    expect(waUi).toContain("Saya sudah memastikan dana resmi diterima");
    expect(waUi).toContain("detail.x904PinGrant.paymentStatus !== \"confirmed\"");
    expect(waUi).toContain("Persetujuan ini tidak langsung membuka pintu");
    expect(ui).toContain("Pengesahan PIN memerlukan pemeriksaan identitas fisik + dana resmi");
  });
});
