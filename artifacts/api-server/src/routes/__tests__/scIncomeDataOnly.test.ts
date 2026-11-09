import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const route=readFileSync(resolve(process.cwd(),"src/routes/scIncome.ts"),"utf8");
const writer=readFileSync(resolve(process.cwd(),"src/lib/scIncomeOperational.ts"),"utf8");
const migration=readFileSync(resolve(process.cwd(),"migrations/20261109_sc_income_operational_register.sql"),"utf8");
describe("SC manual income does not post bank verified movements",()=>{
 it("only inserts into its operational register",()=>{
   expect(route).toContain("INSERT INTO sport_center.sc_income_entries");
   expect(route).not.toMatch(/INSERT INTO public\\.bank_mutations|INSERT INTO.*journal|INSERT INTO.*payments/i);
   expect(route).toContain("ON CONFLICT DO NOTHING");
 });
 it("does not clear nor rewrite kas besar sc",()=>{
   expect(writer).toContain('INCOME_TAB="SC Uang Masuk"');
   expect(writer).not.toContain("values.clear");
   expect(writer).toContain("values.append");
   expect(writer).toContain("SHEET_READBACK_NOT_UNIQUE");
   expect(writer).toContain("SHEET_HEADERS_MISMATCH");
   expect(writer).toContain("DEV_CANNOT_WRITE_PROD_SHEET");
 });
 it("enforces RLS and unique fingerprints and status unverified",()=>{
   expect(migration).toContain("fingerprint text NOT NULL UNIQUE");
   expect(migration).toContain("entry_key uuid NOT NULL UNIQUE");
   expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
   expect(migration).toContain("UNVERIFIED");
 });
});
