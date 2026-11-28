import { formatCorporateReceiptNumber } from "./corporateReceiptNumber";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("global CST Corporate kwitansi numbering", () => {
  test("anchors GM CGK at 014 in November, next company gets 015", () => {
    expect(formatCorporateReceiptNumber(14, "2026-11-28"))
      .toBe("014/KWITANSI-CST/XI/2026");
    expect(formatCorporateReceiptNumber(15, "2026-11-28"))
      .toBe("015/KWITANSI-CST/XI/2026");
  });
  test("Roman month and global numeric sequence do not restart by company", () => {
    expect(formatCorporateReceiptNumber(16, "2026-12-01"))
      .toBe("016/KWITANSI-CST/XII/2026");
    expect(formatCorporateReceiptNumber(17, "2027-01-01"))
      .toBe("017/KWITANSI-CST/I/2027");
  });
  test("rejects bad serial and date", () => {
    expect(() => formatCorporateReceiptNumber(0, "2026-11-28")).toThrow();
    expect(() => formatCorporateReceiptNumber(14, "2026-13-28")).toThrow();
  });
  test("existing group reference is preserved and unpaid receipts cannot claim settlement", () => {
    const bookingUi = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");
    const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
    expect(bookingUi).toContain("Referensi Booking:");
    expect(bookingUi).toContain("DRAFT — BELUM LUNAS (BUKAN BUKTI PEMBAYARAN)");
    expect(route).toContain('statusLabel:paid?"LUNAS":"DRAFT — BELUM LUNAS"');
    expect(route).toContain("issueCorporateReceiptNumber(");
    const schema = readFileSync(resolve(process.cwd(), "migrations/20261128_cst_corporate_kwitansi_global_014.sql"), "utf8");
    expect(schema).toContain("014/KWITANSI-CST/XI/2026");
    expect(schema).toContain("GRP-1794579653965-75664");
    expect(schema).not.toContain("UPDATE sport_center.booking_groups");
  });
});
