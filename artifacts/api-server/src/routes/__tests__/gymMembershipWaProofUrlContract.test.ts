import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/routes/memberships.ts"), "utf8");
const report = readFileSync(resolve(process.cwd(), "src/lib/gymMembershipWaReport.ts"), "utf8");

describe("Gym membership payment WhatsApp proof link", () => {
  it("passes actual payment-specific proof to notifier, not admin membership URL", () => {
    const section = route.split("async function reportGymPayment(")[1]?.split("async function finalizeAdminGymPayment(")[0] ?? "";
    expect(section).toContain("proofUrl:payment.paymentProofUrl || null");
    expect(section).not.toContain("/admin/memberships?memberId=");
    expect(section).not.toContain("reviewUrl");
  });
  it("uses existing branded short proof link for confirmed reports", () => {
    expect(report).toContain('await getOrCreatePaymentProofShortUrl(data.proofUrl)');
    expect(report).toContain('data.event === "confirmed" && data.proofUrl');
    expect(report).toContain('Bukti pembayaran: ${proofText}');
    expect(report).toContain('shortProofUrl !== data.proofUrl');
    expect(report).not.toContain("Bukti pembayaran (buka detail Sport Center)");
  });
  it("does not expose storage proof URL if branded link is unavailable", () => {
    expect(report).toContain('Tersimpan di sistem (tautan bukti belum tersedia)');
    expect(report).toContain('"Belum tersedia"');
    expect(report).toContain('await sendWAToAdmins(report');
    expect(report).toContain('MENUNGGU ACK/READ-BACK');
  });
});
