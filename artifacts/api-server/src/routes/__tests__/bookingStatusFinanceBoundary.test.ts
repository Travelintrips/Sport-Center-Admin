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

  it("requires the canonical invoice settlement fields before treating a company booking as paid", () => {
    expect(route).toContain("function isCompanyInvoicePaymentConfirmed(");
    expect(route).toContain('invoice.status !== "paid"');
    expect(route).toContain("paid >= due - 0.005 && remaining <= 0.005");
    expect(route).toContain("companyInvoicePaymentConfirmed: isCompanyInvoicePaymentConfirmed(invoice)");
  });

  it("does not count an unverified legacy company invoice as paid revenue", () => {
    expect(route).toContain("const paidAmount = isCompanyInvoicePaymentConfirmed(invoice) ? due : 0;");
    expect(route).toContain("!isBookingFullyPaid(booking)");
  });
});
