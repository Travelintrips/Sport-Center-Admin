import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Expenses.tsx"), "utf8");
const sidebar = readFileSync(resolve(process.cwd(), "../sport-center/src/components/layout/AdminLayout.tsx"), "utf8");
const api = readFileSync(resolve(process.cwd(), "src/routes/expenses.ts"), "utf8");

describe("SC expense sidebar and financial summary", () => {
  it("orders Data Karyawan SC immediately after Pengeluaran SC", () => {
    const expense = sidebar.indexOf('href: "/admin/expenses", label: "Pengeluaran SC"');
    const employee = sidebar.indexOf('href: "/admin/sc-employees", label: "Data Karyawan SC"');
    expect(expense).toBeGreaterThan(0);
    expect(employee).toBeGreaterThan(expense);
    expect(sidebar.slice(expense + 'href: "/admin/expenses"'.length, employee)).not.toContain('href: "/admin/');
  });
  it("separates income register and expense summary without mixing their sources", () => {
    expect(ui).toContain('role="tablist"');
    expect(ui).toContain('aria-label="Uang Masuk SC"');
    expect(ui).toContain('aria-label="Pengeluaran SC"');
    expect(ui).toContain("Total Input Uang Masuk — Bulan Ini");
    expect(ui).toContain("incomeData.summary.manualThisMonth");
    expect(ui).toContain("Mutasi Masuk Kas Besar CST — BizPortal");
    expect(ui).toContain("summary.incomingThisMonth");
    expect(ui).toContain("summary.incomingSheetSyncedAt");
    expect(ui).toContain("Pengeluaran Bulan Ini");
    expect(ui).toContain("summary.totalThisMonth");
    expect(ui).not.toContain('>Pending Approval</span>');
    expect(ui).not.toContain('>Belum Dibayar</span>');
    expect(ui).not.toContain('>Sudah Dibayar</span>');
  });
  it("imports inbound sheet mutations read-only without creating bank records", () => {
    const lookup = api.slice(api.indexOf("// Separate, read-only bank-sheet summary"), api.indexOf("res.json({", api.indexOf("// Separate, read-only bank-sheet summary")));
    expect(lookup).toContain("FROM public.bank_sheet_configs bsc");
    expect(lookup).toContain("LEFT JOIN public.bank_mutations bm");
    expect(lookup).toContain("bm.direction = 'IN'");
    expect(lookup).toContain("bm.company_id = bsc.company_id");
    expect(lookup).toContain("bm.bank_account_id = bsc.bank_account_id::text");
    expect(lookup).toContain("timezone('Asia/Jakarta', now())");
    expect(lookup.slice(lookup.indexOf("db.execute(sql`"), lookup.indexOf("`);", lookup.indexOf("db.execute(sql`")))).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
    expect(lookup).toContain("incomingThisMonth: number | null = null");
  });
});

describe("Master Tabel TEST details are read-only and context-aware", () => {
  it("separates recipient, destination bank and masked account for expenses", () => {
    expect(ui).toContain('destinationBank:entry.direction==="OUT"?entry.destinationBank||"":');
    expect(ui).toContain('destinationAccount:entry.direction==="OUT"?entry.destinationAccount||"":');
    expect(ui).toContain('["Bank Tujuan",tx.destinationBank||"Belum diisi"]');
    expect(ui).toContain('["Rekening Tujuan",tx.destinationAccount?"•••• "+tx.destinationAccount.slice(-4):"Belum diisi"]');
    expect(ui).toContain('["Akun Penerima",tx.account||"Tidak diisi"]');
  });
  it("shows sync separate from bank verification and no duplicate description/notes", () => {
    expect(ui).toContain("Status verifikasi bank:");
    expect(ui).toContain("Keperluan / Keterangan");
    expect(ui).toContain("presentTransactionNarrative(tx.description,tx.notes).primary");
    expect(ui).toContain("presentTransactionNarrative(tx.description,tx.notes).additional");
    expect(ui).toContain("Catatan Tambahan");
    expect(ui).not.toContain('["Catatan",tx.notes');
    expect(ui).not.toContain('["Kas Besar SC",tx.cashSheet');
  });
  it("exposes proof when present and explicit absence otherwise, without mutating transactions", () => {
    expect(ui).toContain("Belum ada bukti terlampir");
    expect(ui).toContain("tx.receiptUrls.length>0&&<Button");
    expect(ui).toContain("setProofViewer({testNo:tx.id,urls:tx.receiptUrls,index:0})");
  });
});
