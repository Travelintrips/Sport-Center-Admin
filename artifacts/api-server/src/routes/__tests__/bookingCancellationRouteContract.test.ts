import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("universal booking cancellation route contract", () => {
  const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
  const statusRoute = route.split('router.patch("/bookings/:id", adminMiddleware')[1]?.split('router.post("/bookings/:id/sync-company-invoice"')[0] ?? "";

  it("requires a non-empty cancellation reason and records cancellation history", () => {
    expect(statusRoute).toContain("Note/alasan pembatalan wajib diisi.");
    expect(statusRoute).toContain("tx.insert(bookingHistoryTable).values(historyRows)");
    expect(statusRoute).toContain("adminNotes: previousNotes");
  });

  it("cancels every booking in a group under one database transaction", () => {
    expect(statusRoute).toContain("db.transaction(async (tx) =>");
    expect(statusRoute).toContain("eq(bookingsTable.groupRef, beforeUpdate.groupRef)");
    expect(statusRoute).toContain('status: "cancelled" as any');
  });

  it("uses the shared financial guard before changing status", () => {
    expect(statusRoute).toContain("evaluateBookingCancellation({");
    expect(statusRoute).toContain("paymentsTable.status");
    expect(statusRoute).toContain("companyInvoiceItemsTable");
    expect(statusRoute).toContain("membershipPaymentsTable");
  });
});
