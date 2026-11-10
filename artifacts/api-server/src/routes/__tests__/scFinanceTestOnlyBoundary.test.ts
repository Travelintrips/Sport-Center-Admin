import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  parseTestInput,testNo,testSheetRow,testRowIndexes,testSummary
} from "../../lib/scFinanceTestValidation";

const source=readFileSync(resolve(process.cwd(),"src/lib/scFinanceTestSheet.ts"),"utf8");
const route=readFileSync(resolve(process.cwd(),"src/routes/scFinanceTest.ts"),"utf8");
const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
const migration=readFileSync(resolve(process.cwd(),"../../migrations/20261110_sc_finance_test_ledger.sql"),"utf8");

const sample=(direction:"IN"|"OUT",amount:number,id:number)=>({
  id,direction,transaction_date:"2026-11-10",source_name:"Felicia Justiani",amount,
  notes:"Tes internal",sender_bank:"Mandiri",receiving_account:"Kas Besar SC",
  method:"Simulasi",bank_reference:"TEST-123"
});
describe("SC test-only ledger never creates bank movements or journals",()=>{
  it("places money in column C, money out in D, leaves balance and BizPortal columns untouched",()=>{
    const income=testSheetRow(sample("IN",10000,1));
    const expense=testSheetRow(sample("OUT",3000,2));
    expect(income).toEqual([
      "10/11/2026","SC-TEST-IN: Dana masuk dari FELICIA JUSTIANI | Mandiri - Kas Besar SC | Simulasi | Ref: TEST-123 | Tes internal | SC-TEST-IN-000001",
      10000,"","","Pemasukan","","SC_TEST_ONLY","","","","",""
    ]);
    expect(expense[2]).toBe("");
    expect(expense[3]).toBe(3000);
    expect(expense[4]).toBe("");
    expect(expense[5]).toBe("Pengeluaran");
    expect(expense[6]).toBe("");
    expect(expense[7]).toBe("SC_TEST_ONLY");
    expect(expense).toHaveLength(13);
  });
  it("calculates balances only for synced test records, not unpaid or pending entries",()=>{
    expect(testSummary([
      {direction:"IN",amount:"10000",sheet_sync_state:"synced"},
      {direction:"OUT",amount:"3000",sheet_sync_state:"synced"},
      {direction:"IN",amount:"10000",sheet_sync_state:"removed"},
      {direction:"OUT",amount:"5000",sheet_sync_state:"mismatch"},
      {direction:"OUT",amount:"15000",sheet_sync_state:"pending"},
    ])).toEqual({income:10000,expense:3000,balance:7000,pending:1,count:5});
  });
  it("finds exactly one row for each stable ID on retry",()=>{
    expect(testNo(1,"IN")).toBe("SC-TEST-IN-000001");
    expect(testRowIndexes([["Header"],["A | SC-TEST-IN-000001"],["B | SC-TEST-OUT-000002"]],
      "SC-TEST-IN-000001")).toEqual([2]);
  });
  it("rejects invalid dates and amounts",()=>{
    const ok={entryKey:"9472f5ac-089f-41f2-b557-c6a67a49939d",
      transactionDate:"2026-11-10",sourceName:"Test",direction:"IN",amount:10000};
    expect(parseTestInput(ok).amount).toBe(10000);
    expect(()=>parseTestInput({...ok,transactionDate:"2026-02-30"})).toThrow("INVALID_DATE");
    expect(()=>parseTestInput({...ok,amount:1000001})).toThrow("TEST_AMOUNT_MUST_BE_1_TO_1000000");
  });
  it("requires the verified remote BizPortal runtime guard before any Google append",()=>{
    expect(source).toContain("SC_FINANCE_TEST_SHEETS_ENABLED");
    expect(source).toContain('SC_FINANCE_TEST_SHEETS_ENABLED!=="false"');
    expect(source).toContain('Number(rows[0].bank_account_id)!==1');
    expect(source).toContain('process.env.NODE_ENV==="production"');
    expect(source).toContain("/api/healthz");
    expect(source).toContain("assertBizPortalTestGuard();");
    expect(source).toContain('assertHeaders(');
    expect(source).toContain('SC_TEST_SHEET_READBACK_MISMATCH');
    expect(source).toContain("testRowIndexes");
    expect(source).toContain("startScFinanceTestRetryWorker");
    expect(source).not.toContain("INSERT INTO public.bank_mutations");
  });
  it("read-back reconciliation excludes manually deleted rows and never re-appends them",()=>{
    expect(source).toContain("reconcileScFinanceTestSheets");
    expect(source).toContain("startScFinanceTestSheetReconciliationWorker");
    expect(source).toContain("sheet_sync_state='removed'");
    expect(source).toContain("sheet_sync_state='mismatch'");
    expect(source).toContain('sheet_row=NULL');
    expect(source).toContain('testRowIndexes(rows.map');
    expect(source).toContain("SC_TEST_SHEET_CONTENT_MISMATCH");
    expect(source).toContain("sheet_verified_at=now()");
    expect(route).toContain('sheet_verified_at AS "sheetVerifiedAt"');
    expect(ui).toContain("Diperiksa ");
    expect(source).toContain("sheet_sync_state IN ('pending','failed')");
    expect(route).toContain('router.post("/admin/finance-test/reconcile"');
    expect(ui).toContain("Periksa Ulang Sheets");
    expect(ui).toContain("Dihapus dari Sheets");
    expect(ui).toContain('["pending","failed"].includes(x.sheetSyncState)');
  });
  it("maintains separate test table and Super Admin authorization",()=>{
    expect(migration).toContain("sc_finance_test_entries");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(route).toContain("superAdminMiddleware");
    expect(route).toContain("SC_FINANCE_TEST_CREATED");
    expect(route).not.toContain("INSERT INTO public.accounting");
    expect(route).not.toContain("INSERT INTO public.bank_mutations");
    expect(ui).toContain("Mode Uji Kas Besar SC");
    expect(ui).toContain("Sisa Saldo Uji");
  });
});

describe("Main Keuangan SC forms stay test-only until explicitly cut over", () => {
  it("keeps both income and expense submissions routed to the isolated ledger during TEST",()=>{
    expect(ui).toContain("const FINANCE_SC_TEST_ONLY = true");
    expect(ui).toContain('if(FINANCE_SC_TEST_ONLY){');
    expect(ui).toContain('} else if(FINANCE_SC_TEST_ONLY){');
    expect(ui).toContain('fetch(`${API}/admin/finance-test`');
    expect(ui).toContain('direction:"IN"');
    expect(ui).toContain('direction:"OUT"');
    expect(ui).toContain('entryKey:incomeEntryKey,direction:"IN"');
    expect(ui).toContain('entryKey:expenseTestEntryKey,direction:"OUT"');
    expect(ui).toContain('amount:gross');
    expect(ui).toContain("Input Uang Masuk (TEST)");
    expect(ui).toContain("Tambah Pengeluaran (TEST)");
    expect(ui).toContain("MODE TEST AKTIF");
  });
  it("does not create journals or direct BizPortal mutations from the test entry endpoint",()=>{
    expect(route).toContain('router.post("/admin/finance-test",superAdminMiddleware');
    expect(route).not.toContain("INSERT INTO public.bank_mutations");
    expect(route).not.toContain("INSERT INTO public.accounting_entries");
  });
});
