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
 it("removes the highlighted income register while retaining the input form and unique receipt ID",()=>{
   expect(ui).not.toContain("Pencatatan Uang Masuk SC");
   expect(ui).not.toContain("Manual bulan ini:");
   expect(ui).toContain("result.incomeNo");
   expect(ui).toContain("Input Uang Masuk");
   expect(ui).toContain("Tambah Pengeluaran");
 });

});
