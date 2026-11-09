import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
describe("incoming money operational UI",()=>{
 it("has a distinct preview then explicit save",()=>{
   expect(ui).toContain("Input Uang Masuk");
   expect(ui).toContain("Pratinjau Input");
   expect(ui).toContain("Simpan Uang Masuk");
   expect(ui).toContain("setIncomePreview(true)");
   expect(ui).toContain('method: "POST"');
   expect(ui).toContain("/admin/income");
 });
 it("keeps source, sender bank, recipient bank, amount and date",()=>{
   expect(ui).toContain('id="income-source"');
   expect(ui).toContain('id="income-bank"');
   expect(ui).toContain('id="income-receiving-account"');
   expect(ui).toContain('id="income-amount"');
   expect(ui).toContain('id="income-date"');
   expect(ui).toContain("formatExpenseRupiahInput(incomeForm.amount)");
 });
 it("tracks manual total separately from bank card",()=>{
   expect(ui).toContain("summary.manualThisMonth");
   expect(ui).toContain("Tidak dijumlahkan otomatis dengan mutasi bank");
   expect(ui).toContain("retryIncomeSync");
 });
});
