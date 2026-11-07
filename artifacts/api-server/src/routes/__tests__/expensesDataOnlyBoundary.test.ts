import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/routes/expenses.ts"), "utf8");

describe("Sport Center expense ownership boundary", () => {
  const payAction = route.split('router.patch("/admin/expenses/:id/status"')[1]?.split('router.delete("/admin/expenses/:id"')[0] ?? "";
  const createAction = route.split('router.post("/admin/expenses",')[1]?.split('router.patch("/admin/expenses/:id"')[0] ?? "";

  it("never creates local or public accounting journals on paid transition", () => {
    expect(payAction).toContain('updateData["paidAt"] = new Date()');
    expect(payAction).not.toContain("createExpenseJournalEntry(");
    expect(payAction).not.toContain("createPublicExpenseAccountingEntry(");
    expect(payAction).toContain("await syncToPublic(updated!, facilityName)");
  });

  it("treats operational expense mirror separately from bank mutations", () => {
    expect(createAction).toContain('paymentStatus: "draft"');
    expect(createAction).toContain("await syncToPublic(expense!, facilityName)");
    expect(route).not.toContain("bankMutationsTable");
    expect(route).not.toContain("pushReconciliationToSheet(");
  });

  it("requires accounting note and positive amount", () => {
    expect(createAction).toContain('notes.trim().length < 3');
    expect(createAction).toContain("Number(amount) <= 0");
    expect(createAction).toContain("Number(ppnAmount) < 0");
    expect(createAction).toContain("notes: notes.trim()");
  });
});
