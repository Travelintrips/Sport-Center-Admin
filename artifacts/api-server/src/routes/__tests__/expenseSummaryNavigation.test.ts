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
  it("shows only two cards with distinct sources", () => {
    expect(ui).toContain('>Pengeluaran Bulan Ini (Rp)</span>');
    expect(ui).toContain('>Uang Masuk (Rp)</span>');
    expect(ui).toContain('summary.incomingThisMonth');
    expect(ui).toContain('summary.incomingSheetSyncedAt');
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
