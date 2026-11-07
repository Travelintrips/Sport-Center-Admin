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

  test("PIN approval remains explicit staff attestation and never payment-only", () => {
    expect(waUi).toContain("Saya telah memeriksa langsung identitas pengunjung");
    expect(waUi).toContain("Saya sudah memastikan dana resmi diterima");
    expect(waUi).toContain("detail.x904PinGrant.paymentStatus !== \"confirmed\"");
    expect(waUi).toContain("Persetujuan ini tidak langsung membuka pintu");
    expect(ui).toContain("Pengesahan PIN memerlukan pemeriksaan identitas fisik + dana resmi");
  });
});
