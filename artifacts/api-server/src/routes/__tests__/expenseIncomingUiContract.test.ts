import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Expenses.tsx"), "utf8");
describe("SC incoming funds UI-only form", () => {
  it("shows incoming funds button before add expense button", () => {
    expect(ui.indexOf("> Input Uang Masuk")).toBeGreaterThan(0);
    expect(ui.indexOf("> Tambah Pengeluaran")).toBeGreaterThan(ui.indexOf("> Input Uang Masuk"));
    expect(ui).toContain('<Dialog open={incomeOpen}');
  });
  it("keeps requested fields and editable suggestions", () => {
    expect(ui).toContain('htmlFor="income-date"');
    expect(ui).toContain('htmlFor="income-source"');
    expect(ui).toContain('Felicia Justiani');
    expect(ui).toContain('Cahaya Sejati Teknologi');
    expect(ui).toContain('Angelia Nirwana');
    expect(ui).toContain('Transfer Bank');
    expect(ui).toContain('htmlFor="income-bank"');
    expect(ui).toContain('Mandiri');
    expect(ui).toContain('BCA');
    expect(ui).toContain('htmlFor="income-amount"');
    expect(ui).toContain('formatExpenseRupiahInput(incomeForm.amount)');
  });
  it("does not offer saving or calling any payments/ledger API", () => {
    const begin=ui.indexOf('{/* Incoming funds: UI-only form.');
    const end=ui.indexOf('{/* Form Dialog */}',begin);
    const modal=ui.slice(begin,end);
    expect(begin).toBeGreaterThan(0);
    expect(modal).toContain('setIncomePreview(true)');
    expect(modal).toContain('Pratinjau Input');
    expect(modal).toContain('belum tersimpan');
    expect(modal).not.toContain('fetch(');
    expect(modal).not.toContain('.mutate(');
    expect(modal).not.toContain('Simpan Uang Masuk');
  });
  it("removes status filter and allows searching reference and notes", () => {
    expect(ui).toContain('Cari pengeluaran, cari nama, nomor ref...');
    expect(ui).toContain('e.bankReference?.toLowerCase().includes(q)');
    expect(ui).toContain('e.notes?.toLowerCase().includes(q)');
    expect(ui).not.toContain('setFilterStatus');
    expect(ui).not.toContain('Semua Status');
  });
});
