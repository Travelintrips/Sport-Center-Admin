import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("admin booking paid WA report proof short links", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/notifications.ts"), "utf8");
  const report = source.split("export async function notifyAdminBookingReport(")[1]
    ?.split("export async function notifyPaymentProofUploaded(")[0] ?? "";

  it("uses existing short proof resolver only for paid booking reports", () => {
    expect(report).toContain("paid && data.proofUrl");
    expect(report).toContain("await getOrCreatePaymentProofShortUrl(data.proofUrl)");
  });

  it("never embeds raw payment storage URL into the admin booking report", () => {
    expect(report).toContain("📎 Bukti pembayaran: \${brandedProofText}");
    expect(report).not.toContain('data.proofUrl ? data.proofUrl : "Tersimpan"');
    expect(report).toContain("shortenedProofUrl !== data.proofUrl");
    expect(report).toContain("Tersimpan (tautan pendek belum tersedia)");
  });

  it("preserves the existing one-report dispatch and deduplication event keys", () => {
    expect(report).toContain("await sendWAToAdmins(message, {");
    expect(report).toContain('event: paid ? "admin_booking_paid_report" : "admin_booking_unpaid_report"');
  });
});
