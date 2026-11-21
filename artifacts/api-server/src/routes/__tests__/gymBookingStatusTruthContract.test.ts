import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");

describe("Gym booking payment and physical access statuses remain distinct", () => {
  test("paid/confirmed booking never claims X904 access without ACK", () => {
    expect(source).toContain("gymAccessReady");
    expect(source).toContain("Pembayaran terverifikasi; akses Gym BELUM aktif — tunggu aktivasi dan ACK X904");
    expect(source).toContain("Pembayaran terverifikasi; akses Gym aktif dengan ACK X904");
    expect(source).not.toContain("Pembayaran sudah diverifikasi, booking aktif");
  });
});
