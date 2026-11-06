import { describe, expect, it, jest } from "@jest/globals";
import { formatRekapWhatsapp } from "./rekapPemakaian";

jest.mock("@workspace/db", () => ({}));
jest.mock("./notifications", () => ({ sendWAToAdmins: jest.fn() }));
jest.mock("./logger", () => ({ logger: { warn: jest.fn(), info: jest.fn() } }));

describe("Rekap Pemakaian — X904 review-only scan", () => {
  it("shows a pending scan without saying it is paid or a confirmed check-in", () => {
    const output = formatRekapWhatsapp({
      GYM: [{
        customerName: "SHIDQI",
        startTime: "19:01",
        endTime: "19:01",
        kategori: "GYM",
        status: "scan_unverified",
        customerLabel: "m",
      }],
    }, "2026-11-06");
    expect(output).toContain("SHIDQI (m) ⚠️ scan perlu verifikasi");
    expect(output).toContain("bukan check-in resmi atau bukti bayar");
    expect(output).not.toContain("SHIDQI (m) ✅");
    expect(output).not.toContain("SHIDQI (m) ❌");
  });

  it("keeps confirmed visits formatted normally", () => {
    const output = formatRekapWhatsapp({
      GYM: [{
        customerName: "MEMBER TERKONFIRMASI",
        startTime: "07:00",
        endTime: "07:00",
        kategori: "GYM",
        status: "confirmed",
        customerLabel: "m",
      }],
    }, "2026-11-06");
    expect(output).toContain("MEMBER TERKONFIRMASI (m) ✅");
  });
});
