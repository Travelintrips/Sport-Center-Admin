import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");

describe("admin booking status and notes safety contract", () => {
  test("notes-only PATCH does not trigger booking status or finance workflows", () => {
    const notesStart = route.indexOf("// Notes-only must never masquerade");
    const cancellationStart = route.indexOf("// Universal cancellation path", notesStart);
    expect(notesStart).toBeGreaterThan(0);
    expect(cancellationStart).toBeGreaterThan(notesStart);
    const path = route.slice(notesStart, cancellationStart);
    expect(path).toContain("if (!status && adminNotes !== undefined && !hasAdditionalChargesUpdate)");
    expect(path).toContain(".set({ adminNotes, updatedAt: new Date() })");
    expect(path).toContain("bookingHistoryTable");
    expect(path).toContain("res.json(refreshed)");
    expect(path).not.toContain("syncStatusToBizportal(");
    expect(path).not.toContain("reversePublicAccountingEntry(");
  });
  test("table and details require reason before cancellation, backend checks payment state", () => {
    expect(ui).toContain("openTableCancellation(id, 1, false)");
    expect(ui).toContain("tableCancellationReason.trim()");
    expect(ui).toContain("cancellationReason.trim()");
    expect(route).toContain("BOOKING_CANCELLATION_REASON_REQUIRED");
    expect(route).toContain("BOOKING_CANCELLATION_REQUIRES_REFUND");
    expect(route).toContain("evaluateBookingCancellation({");
  });
  test("refund requires independent financial workflow rather than a status dropdown", () => {
    expect(route).toContain("REFUND_REQUIRES_VERIFIED_FINANCIAL_WORKFLOW");
    expect(ui).not.toContain('action="refunded"');
    expect(ui).toContain("Pengembalian dana harus dibuktikan");
  });
  test("confirmed bookings cannot silently become unpaid", () => {
    expect(route).toContain("BOOKING_STATUS_DOWNGRADE_BLOCKED");
    expect(route).toContain("BOOKING_CONFIRM_REQUIRES_PAYMENT_VERIFICATION");
  });
  test("notes use their own callback without submitting status", () => {
    expect(ui).toContain("onClick={() => onSaveAdminNotes(adminNotes)}");
    expect(ui).toContain("data: { adminNotes: notes } as any");
    expect(ui).toContain("Catatan admin tersimpan");
  });
});
