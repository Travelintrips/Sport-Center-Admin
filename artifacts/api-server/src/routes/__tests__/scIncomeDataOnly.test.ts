import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const route=readFileSync(resolve(process.cwd(),"src/routes/scIncome.ts"),"utf8");
const validation=readFileSync(resolve(process.cwd(),"src/lib/scIncomeValidation.ts"),"utf8");
const writer=readFileSync(resolve(process.cwd(),"src/lib/scIncomeOperational.ts"),"utf8");
const migration=readFileSync(resolve(process.cwd(),"../../migrations/20261109_sc_income_operational_register.sql"),"utf8");
describe("SC manual income does not post bank verified movements",()=>{
 it("only inserts into its operational register",()=>{
   expect(route).toContain("INSERT INTO sport_center.sc_income_entries");
   expect(route).not.toMatch(/INSERT INTO public\\.bank_mutations|INSERT INTO.*journal|INSERT INTO.*payments/i);
   expect(route).toContain("ON CONFLICT DO NOTHING");
 });
 it("does not clear nor rewrite kas besar sc",()=>{
   expect(validation).toContain('INCOME_TAB="SC Uang Masuk"');
   expect(writer).not.toContain("values.clear");
   expect(writer).toContain("values.append");
   expect(writer).toContain("SHEET_READBACK_NOT_UNIQUE");
   expect(writer).toContain("SHEET_HEADERS_MISMATCH");
   expect(writer).toContain("DEV_CANNOT_WRITE_PROD_SHEET");
 });
 it("permits a distinct same-day receipt only after explicit duplicate confirmation",()=>{
   const followup=readFileSync(resolve(process.cwd(),"../../migrations/20261109_sc_income_allow_confirmed_same_day_repeats.sql"),"utf8");
   const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
   expect(route).toContain("confirmSimilar !== true");
   expect(ui).toContain("Tetap Simpan — Transaksi Berbeda");
   expect(followup).toContain("DROP CONSTRAINT IF EXISTS sc_income_entries_fingerprint_key");
 });
 it("enforces RLS and unique fingerprints and status unverified",()=>{
   expect(migration).toContain("fingerprint text NOT NULL UNIQUE");
   expect(migration).toContain("entry_key uuid NOT NULL UNIQUE");
   expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
   expect(migration).toContain("UNVERIFIED");
 });
});


describe("Income and expense candidates remain read-only and account scoped", () => {
  it("limits income candidates to the mapped CST bank account and does not write reconciliations", () => {
    expect(route).toContain("bsc.id=12 AND bsc.company_id=1");
    expect(route).toContain("bm.company_id=bsc.company_id");
    expect(route).toContain("bm.bank_account_id=bsc.bank_account_id::text");
    expect(route).toContain('verified:false');
    const lookup = route.split('router.get("/admin/income/:id/mutation-candidates"')[1];
    expect(lookup).toBeDefined();
    expect(lookup).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.bank_mutations/i);
  });
  it("shows income candidate inspection without silently posting bank receipts", () => {
    const ui = readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
    expect(ui).toContain("Cek kandidat bank");
    expect(ui).toContain("Kandidat mutasi BizPortal (baca saja");
    expect(ui).toContain("/mutation-candidates");
  });
});
