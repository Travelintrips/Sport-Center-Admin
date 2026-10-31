import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("booking status update financial boundary", () => {
  const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const statusRoute = route.split('router.patch("/bookings/:id", adminMiddleware')[1]?.split('router.post("/bookings/:id/sync-company-invoice"')[0] ?? "";

  it("cannot create a bank mutation from a booking status change", () => {
    expect(statusRoute).not.toContain("pushConfirmedPaymentAsBankMutation(");
  });

  it("cannot send payment confirmation or invoice just from a booking status change", () => {
    expect(statusRoute).not.toContain("notifyPaymentConfirmed(");
    expect(statusRoute).not.toContain("sendGroupInvoiceToCustomer(");
    expect(statusRoute).not.toContain("sendInvoiceToCustomer(");
  });

  it("preserves actual booking cancellation notifications", () => {
    expect(statusRoute).toContain("notifyBookingCancelled(");
  });

  it("does not forge a paidAt timestamp on booking confirmation", () => {
    expect(statusRoute).not.toContain('status === "confirmed" ? new Date() : null');
  });
});
