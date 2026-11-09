import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Gym VIS operational monitoring contract", () => {
  const api = readFileSync(join(process.cwd(),"src/routes/waBookingsAdmin.ts"),"utf8");
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

  test("Booking Admin shows one-place lifecycle, pool and guarded return", () => {
    expect(ui).toContain("Pool VIS / X904");
    expect(ui).toContain("Access ID");
    expect(ui).toContain("ACK / read-back");
    expect(ui).toContain("Kembalikan Kartu ke Pool");
    expect(ui).toContain("gymVisAccess?.returnReady");
    expect(ui).toContain("visPhysicalReturned");
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
