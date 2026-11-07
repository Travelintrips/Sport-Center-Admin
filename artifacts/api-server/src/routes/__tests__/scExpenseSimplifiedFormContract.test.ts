import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Expenses.tsx"), "utf8");
const route = readFileSync(resolve(process.cwd(), "src/routes/expenses.ts"), "utf8");
const sourceSchema = readFileSync(resolve(process.cwd(), "../../lib/db/src/schema/expenses.ts"), "utf8");
const mirrorSchema = readFileSync(resolve(process.cwd(), "../../lib/db/src/schema/publicExpenses.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "../../migrations/20261107_sc_expenses_bank_reference_only.sql"), "utf8");

describe("SC Expense simple form based on bank mutation examples", () => {
  it("has one required note and editable recipient plus evidence controls", () => {
    expect(ui).toContain("Catatan / Tujuan Pengeluaran");
    expect(ui).toContain("value={form.notes}");
    expect(ui).toContain("minLength={3} required");
    expect(ui).not.toContain("<Label>Deskripsi");
    expect(ui).toContain("Penerima Pembayaran (opsional)");
    expect(ui).toContain("sc-employees-expense-recipient");
    expect(ui).toContain("setRecipientFocused(true)");
    expect(ui).toContain("Bukti Pembayaran / Nota / Struk");
  });
  it("preserves source fund separately from payment method and GL COA", () => {
    expect(ui).toContain("Sumber Dana (hanya keterangan)");
    expect(ui).toContain("Tidak memetakan COA");
    expect(ui).toContain("Pengaturan tambahan (fasilitas, pajak, kategori)");
    expect(ui).not.toContain("Kategori internal (opsional, bukan COA jurnal)");
  });
  it("keeps bank reference as optional non-posting metadata in both tables", () => {
    expect(ui).toContain("Nomor Referensi Bank (opsional)");
    expect(sourceSchema).toContain('bankReference: text("bank_reference")');
    expect(mirrorSchema).toContain('bankReference: text("bank_reference")');
    expect(route).toContain("bankReference: expense.bankReference");
    expect(route).toContain("bankReference: bankReference !== undefined");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS bank_reference text");
    expect(route).not.toContain("createExpenseJournalEntry(");
    expect(route).not.toContain("createPublicExpenseAccountingEntry(");
  });
});
