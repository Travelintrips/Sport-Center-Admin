import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(process.cwd(), "src/routes/expenses.ts"), "utf8");
const ui = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Expenses.tsx"), "utf8");

describe("SC expense vs BizPortal Sheets reconciliation boundary", () => {
  const lookup = route.split('router.get("/admin/expenses/:id/sheet-candidates"')[1]?.split('router.get("/admin/expenses/:id"')[0] ?? "";
  it("is admin-only and checks paid status before lookup", () => {
    expect(lookup).toContain("adminMiddleware");
    expect(lookup).toContain('expense.paymentStatus !== "paid"');
    expect(lookup).toContain("verified: false");
  });
  it("only reads canonical OUT mutations scoped to BizPortal account and sheet", () => {
    expect(lookup).toContain("FROM public.bank_mutations bm");
    expect(lookup).toContain("JOIN public.bank_sheet_configs bsc");
    expect(lookup).toContain("cba.company_id = bsc.company_id");
    expect(lookup).toContain("bm.company_id = bsc.company_id");
    expect(lookup).toContain("bm.bank_account_id = bsc.bank_account_id::text");
    expect(lookup).toContain("upper(bm.direction) = 'OUT'");
    expect(lookup).toContain("bm.amount =");
    expect(lookup).toContain("LIMIT 21");
  });
  it("never modifies bank mutation or Sheet or creates a journal", () => {
    expect(lookup).not.toMatch(/\b(insert|update|delete)\s+(into\s+|from\s+)?(?:public\.)?(bank_mutations|bank_sheet_configs)/i);
    expect(lookup).not.toContain("spreadsheets.values");
    expect(lookup).not.toContain("createPublicExpenseAccountingEntry");
    expect(lookup).not.toContain("verified: true");
    expect(ui).toContain("Cari mutasi");
    expect(ui).toContain("kandidat belum diverifikasi");
  });
});
