import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("booking status and payment sync separation", () => {
  const sync = readFileSync(resolve(process.cwd(), "src/lib/bizportalSync.ts"), "utf8");
  const bookings = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const statusPatch = bookings.split('router.patch("/bookings/:id", adminMiddleware')[1]?.split('router.post("/bookings/:id/sync-company-invoice"')[0] ?? "";

  it("preserves existing BizPortal payment state on manual booking status edits", () => {
    expect(statusPatch).toContain("{ preservePaymentStatus: true }");
    expect(sync).toContain("payment_status    = CASE WHEN $18 THEN payment_status ELSE $3 END");
    expect(sync).toContain("options?.preservePaymentStatus === true");
  });

  it("keeps the dedicated paid company invoice sync path distinct", () => {
    expect(bookings).toContain('result.invoice.paymentProofUrl,');
    expect(bookings).toContain('billingStatus: "paid"');
  });
});
