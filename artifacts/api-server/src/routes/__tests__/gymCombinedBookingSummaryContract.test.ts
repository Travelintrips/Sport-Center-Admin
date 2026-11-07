import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookings = readFileSync(resolve(process.cwd(), "src/routes/bookings.ts"), "utf8");
const membership = readFileSync(resolve(process.cwd(), "src/routes/memberships.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");
const checkout = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/CheckoutForm.tsx"), "utf8");

describe("Combined Gym membership booking summary (read-only, no duplicate bank receipt)", () => {
  test("projects only confirmed allocations from an approved parent receipt", () => {
    expect(bookings).toContain("combinedGymByPaymentId");
    expect(bookings).toContain("a.membership_payment_id");
    expect(bookings).toContain("r.status='photo_approved'");
    expect(bookings).toContain("a.status='confirmed'");
    expect(bookings).toContain("combinedGymReceipt:");
    expect(bookings).toContain("bank_mutation_id IS NULL");
  });
  test("never writes a fake groupRef or performs normal group mutations", () => {
    expect(ui).toContain("gym-receipt:");
    expect(ui).toContain("combinedGymCountByReceiptId");
    expect(ui).toContain("combinedGymReceipt.allocationCount");
    expect(ui).toContain("Status per member di Detail Grup");
    expect(ui).toContain("isCombinedGymGroup");
  });
  test("single receipt mirror to BizPortal has no second bank mutation", () => {
    expect(membership).toContain("groupRef: `GYM-GAB-${combinedReceipt.id}`");
    expect(membership).toContain("groupTotal: combinedReceipt.total");
    expect(membership).toContain("receiptId, total:result.combinedReceiptTotal");
    expect(membership).toContain("These mirrors are non-bank side effects");
  });
  test("combined form cannot accidentally submit the normal booking action", () => {
    expect(checkout).toContain('value="membership_combined"');
    expect(checkout).toContain('if (bookingKind === "membership_combined")');
    expect(checkout).toContain('setCombinedOpen(true)');
    expect(checkout).toContain('onSubmit={submitCombinedReceipt}');
  });
});
