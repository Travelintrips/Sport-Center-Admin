import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Expenses.tsx"), "utf8");

describe("Income preview: bank source vs receiving bank", () => {
  it("provides a separate editable receiving bank/account field", () => {
    expect(ui).toContain('htmlFor="income-bank">Bank Pengirim (opsional)');
    expect(ui).toContain('htmlFor="income-receiving-account"');
    expect(ui).toContain("Bank / Akun Penerima");
    expect(ui).toContain('value={incomeForm.receivingAccount}');
    expect(ui).toContain('value={incomeForm.bank}');
    expect(ui).toContain('<option value="blu by BCA Digital" />');
  });
  it("shows receiving account in preview and requires for bank transfer", () => {
    expect(ui).toContain('Bank / Akun Penerima: {incomeForm.receivingAccount.trim()');
    expect(ui).toContain('(incomeForm.method === "Transfer Bank" && !incomeForm.receivingAccount.trim())');
    expect(ui).not.toContain('(incomeForm.method === "Transfer Bank" && !incomeForm.bank.trim())');
  });
  it("remains preview only without writing database or sheets", () => {
    const begin = ui.indexOf('{/* Incoming funds: UI-only form.');
    const end = ui.indexOf('{/* Form Dialog */}', begin);
    const modal = ui.slice(begin, end);
    expect(modal).toContain("setIncomePreview(true)");
    expect(modal).not.toContain("fetch(");
    expect(modal).not.toContain(".mutate(");
  });
});
