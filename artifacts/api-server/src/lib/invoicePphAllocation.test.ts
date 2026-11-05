import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allocateInvoicePphRounding, discloseInvoicePphRounding } from "./invoicePphAllocation";

const sessions = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  bookingDate: "2026-11-" + String(index + 3).padStart(2, "0"),
  orderNumber: "SC-" + (1721 + index),
  pphAmount: "63063",
  totalAmount: "700000",
  taxAmount: "69369",
}));

describe("Corporate invoice PPh rounding allocation", () => {
  it("reconciles Korsenil 12 sessions without changing input records", () => {
    const snapshot = JSON.stringify(sessions);
    const result = allocateInvoicePphRounding(sessions, 756757);
    expect(result.reduce((sum, row) => sum + row.allocatedPph, 0)).toBe(756757);
    expect(result.slice(0, 11).every((row) => row.allocatedPph === 63063)).toBe(true);
    expect(result[11].allocatedPph).toBe(63064);
    expect(result[11].roundingAdjustment).toBe(1);
    expect(JSON.stringify(sessions)).toBe(snapshot);
    expect(8400000 - result.reduce((sum, row) => sum + row.allocatedPph, 0)).toBe(7643243);
  });

  it("reports the adjustment on the last session for transparency", () => {
    const result = allocateInvoicePphRounding(sessions, 756757);
    const invoiceItems = result.map(({ item, allocatedPph }) => ({ ...item, pphAmount: allocatedPph }));
    expect(discloseInvoicePphRounding(invoiceItems, 10, 756757)).toEqual([
      { itemId: 12, orderNumber: "SC-1732", adjustment: 1 },
    ]);
  });

  it("does not alter already reconciled or zero-withholding items", () => {
    const result = allocateInvoicePphRounding([{ ...sessions[0], pphAmount: 0 }], 0);
    expect(result[0].roundingAdjustment).toBe(0);
    expect(result[0].allocatedPph).toBe(0);
  });

  it("handles negative one-rupiah adjustment safely", () => {
    const result = allocateInvoicePphRounding(sessions.slice(0, 2), 126125);
    expect(result.map((x) => x.allocatedPph)).toEqual([63063, 63062]);
  });

  it("rejects mismatched taxes rather than masking large discrepancies", () => {
    expect(() => allocateInvoicePphRounding(sessions, 756790)).toThrow("INVOICE_PPH_ROUNDING_EXCEEDS_ONE_RUPIAH_PER_ITEM");
    expect(() => allocateInvoicePphRounding(sessions, -1)).toThrow("INVALID_INVOICE_PPH");
  });
});


describe("invoice generation regression guards", () => {
  const route = readFileSync(resolve(process.cwd(), "src/routes/companyInvoices.ts"), "utf8");
  const renderer = readFileSync(resolve(process.cwd(), "src/lib/documentRenderer.ts"), "utf8");

  it("never rewrites historical booking tax snapshots while inserting invoice items", () => {
    const block = route.split("async function buildAndInsertItems(")[1]?.split("async function reconcileUnpaidInvoicePphItems(")[0] ?? "";
    expect(block).not.toContain("executor.update(bookingsTable)");
    expect(block).toContain("executor.insert(companyInvoiceItemsTable)");
  });

  it("allocates only to new invoices or fully unpaid existing invoices", () => {
    expect(route).toContain("await reconcileUnpaidInvoicePphItems(tx, inv.id, pphAmount)");
    expect(route).toContain('existingInvoice.status === "unpaid" && Number(existingInvoice.paidAmount ?? 0) === 0');
    expect(route).toContain("await reconcileUnpaidInvoicePphItems(tx, existingInvoice.id, newPphAmount)");
    expect(route).toContain('invoice.status === "unpaid" && Number(invoice.paidAmount ?? 0) === 0');
    expect(route).toContain('if (openInvoice && existingInvoice)');
    expect(route).toContain('if (inv.status !== "unpaid" || Number(inv.paidAmount ?? 0) > 0)');
  });

  it("discloses rupiah-level session adjustments on invoice documents", () => {
    expect(renderer).toContain("discloseInvoicePphRounding(");
    expect(renderer).toContain("Penyesuaian pembulatan PPh per sesi");
  });
});
