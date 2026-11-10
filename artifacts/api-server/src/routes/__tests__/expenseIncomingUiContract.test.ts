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
   expect(ui).toContain("Histori Uang Masuk SC");
   expect(ui).toContain("Histori Uang Masuk");
   expect(ui).toContain("entry.incomeNo");
   expect(ui).toContain("incomeData.entries.map");
   expect(ui).not.toContain("Manual bulan ini:");
   expect(ui).toContain("result.incomeNo");
   expect(ui).toContain("Input Uang Masuk");
   expect(ui).toContain("Tambah Pengeluaran");
 });

});


describe("separated financial navigation", () => {
  it("isolates the visible income and expense workflows in their own tab panels", () => {
    expect(ui).toContain('financeSection');
    expect(ui).toContain('role="tablist"');
    expect(ui).toContain('aria-label="Uang Masuk SC"');
    expect(ui).toContain('aria-label="Pengeluaran SC"');
    expect(ui).not.toContain('>Riwayat Pemasukan</CardTitle>');
    expect(ui).toContain("Master Tabel Transaksi");
    expect(ui).toContain("Mutasi Masuk Kas Besar CST — BizPortal");
    expect(ui).toContain("Total Input Uang Masuk — Bulan Ini");
  });
});

describe("unified transaction detail view", () => {
  it("shows read-only combined income/expense details with clear filters", () => {
    expect(ui).toContain('aria-label="Detail Transaksi Keuangan SC"');
    expect(ui).toContain("unifiedTransactions");
    expect(ui).toContain("incomeData?.entries");
    expect(ui).toContain("allExpenses.map");
    expect(ui).toContain("Cari transaksi keuangan");
    expect(ui).toContain("Master Tabel Transaksi");
    expect(ui).toContain("Rincian ");
  });
});

describe("expandable master finance table", () => {
  it("has accessible inline expansion and no separate detail button", () => {
    expect(ui).toContain('aria-expanded={expandedTransactionIds.includes(tx.key)}');
    expect(ui).toContain('onClick={() => toggleExpandedTransaction(tx.key)}');
    expect(ui).toContain('<td colSpan={3}');
    expect(ui).toContain("Buka Semua");
    expect(ui).toContain("Tutup Semua");
    expect(ui).not.toContain("Salin Detail");
    expect(ui).not.toContain("Histori Lengkap");
  });
  it("supports one exact day or an inclusive from/to range and invalid-range warning", () => {
    expect(ui).toContain('value="single">Tanggal tunggal');
    expect(ui).toContain('value="range">Rentang tanggal');
    expect(ui).toContain('tx.date === transactionSingleDate');
    expect(ui).toContain('tx.date >= transactionDateFrom');
    expect(ui).toContain('tx.date <= transactionDateTo');
    expect(ui).toContain('transactionDateFrom > transactionDateTo');
    expect(ui).toContain('Tanggal awal tidak boleh lebih besar');
  });
});


describe("income register UI removed safely", () => {
  it("hides the duplicate inline income history without deleting read-only master records", () => {
    expect(ui).not.toContain('>Riwayat Pemasukan</CardTitle>');
    expect(ui).toContain("incomeData?.entries");
    expect(ui).toContain('aria-label="Detail Transaksi Keuangan SC"');
    expect(ui).toContain("Total Input Uang Masuk — Bulan Ini");
    expect(ui).toContain("Input Uang Masuk");
  });
});
