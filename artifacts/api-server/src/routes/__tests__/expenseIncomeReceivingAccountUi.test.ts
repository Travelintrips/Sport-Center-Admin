import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Expenses.tsx"), "utf8");

describe("Income preview: bank source vs receiving bank", () => {
  it("provides a separate editable receiving bank/account field", () => {
    expect(ui).toContain('htmlFor="income-bank">Bank Pengirim <span className="text-red-500">*</span>');
    expect(ui).toContain('htmlFor="income-receiving-account"');
    expect(ui).toContain("Bank / Akun Penerima");
    expect(ui).toContain('value={incomeForm.receivingAccount}');
    expect(ui).toContain('value={incomeForm.bank}');
    expect(ui).toContain('"blu by BCA Digital"');
  });
  it("shows receiving account in preview and requires for bank transfer", () => {
    expect(ui).toContain('Bank / Akun Penerima: {incomeForm.receivingAccount.trim()');
    expect(ui).toContain('(incomeForm.method === "Transfer Bank" && !incomeForm.receivingAccount.trim())');
    expect(ui).toContain('!incomeForm.bank.trim()');
    const source = ui.indexOf('htmlFor="income-source"');
    const sender = ui.indexOf('htmlFor="income-bank"');
    const method = ui.indexOf('<Label>Metode ');
    expect(source).toBeGreaterThan(0);
    expect(sender).toBeGreaterThan(source);
    expect(method).toBeGreaterThan(sender);
    expect(ui.slice(sender,method)).toContain('required');
  });
  it("uses application dropdowns with a manual option for all three fields", () => {
    expect(ui).toContain('function IncomeDropdown(');
    expect(ui).toContain('<SelectTrigger id={id} aria-required={required}>');
    expect(ui).toContain('<SelectItem value="__manual__">Lainnya (isi manual)</SelectItem>');
    expect(ui).toContain('id="income-source"');
    expect(ui).toContain('id="income-bank"');
    expect(ui).toContain('id="income-receiving-account"');
    expect(ui).not.toContain('<datalist id="income-source-suggestions">');
    expect(ui).not.toContain('<datalist id="income-bank-suggestions">');
    expect(ui).not.toContain('<datalist id="income-receiving-suggestions">');
  });
  it("preview itself never writes database or sheets", () => {
    const begin = ui.indexOf('{/* Incoming funds: save to SC operational register, not bank movements.');
    const end = ui.indexOf('{/* Form Dialog */}', begin);
    const modal = ui.slice(begin, end);
    expect(modal).toContain("setIncomePreview(true)");
    expect(modal).not.toContain("fetch(");
    expect(modal).not.toContain(".mutate(");
  });
});
