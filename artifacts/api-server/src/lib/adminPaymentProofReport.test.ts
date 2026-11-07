import { buildAdminPaymentProofReport, isAuthorizedAdminProofUploader } from "./adminPaymentProofReport";

describe("compact admin WA proof report", () => {
  it("shows two separate proof URLs for Falcons DP and pelunasan, without approval link or fake pending status", () => {
    const message = buildAdminPaymentProofReport({
      groupRef: "CART-MVI6CQT9-XTGP",
      orderNumber: "SC-1552",
      paymentId: 877,
      proofs: [
        {label: "DP", amount: 13933700, url: "https://sc.travelintrips.co.id/proof/DPxxxx12"},
        {label: "Pelunasan", amount: 10000000, url: "https://sc.travelintrips.co.id/proof/LUNASx12"},
      ],
    });
    expect(message).toContain("Tap link untuk lihat bukti:");
    expect(message).toContain("DP (Rp 13.933.700)");
    expect(message).toContain("Pelunasan (Rp 10.000.000)");
    expect(message).toContain("/proof/DPxxxx12");
    expect(message).toContain("/proof/LUNASx12");
    expect(message).not.toContain("MENUNGGU VERIFIKASI");
    expect(message).not.toContain("konfirmasi:");
    expect(message).not.toContain("DETAIL SELURUH SESI");
  });
  it("uses verified uploader role even if the original booking came from frontend", () => {
    expect(isAuthorizedAdminProofUploader({ role: "admin" })).toBe(true);
    expect(isAuthorizedAdminProofUploader({ role: "finance" })).toBe(true);
    expect(isAuthorizedAdminProofUploader({ role: "staff" })).toBe(false);
    expect(isAuthorizedAdminProofUploader({ role: "customer" })).toBe(false);
    expect(isAuthorizedAdminProofUploader(null)).toBe(false);
  });
  it("fails closed without a proof URL", () => {
    expect(() => buildAdminPaymentProofReport({
      orderNumber: "SC-1552", paymentId: 877,
      proofs: [{ label: "Pelunasan", amount: 10000000, url: "" }],
    })).toThrow("ADMIN_PAYMENT_PROOF_URL_REQUIRED");
  });
});
