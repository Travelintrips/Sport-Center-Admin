import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {cashIncomeNumber,cashLedgerRow,cashLedgerPositions} from "../../lib/scIncomeCashLedgerValidation";
const route=readFileSync(resolve(process.cwd(),"src/routes/scIncome.ts"),"utf8");
const worker=readFileSync(resolve(process.cwd(),"src/lib/scIncomeCashLedger.ts"),"utf8");
const ui=readFileSync(resolve(process.cwd(),"../sport-center/src/pages/admin/Expenses.tsx"),"utf8");
describe("Cash-only bank-sheet feed",()=>{
 it("formats confirmed physical cash with legacy column positions and no guessed metadata",()=>{
  expect(cashLedgerRow({id:7,transaction_date:"2026-11-09",source_name:"Felicia Justiani",amount:"10000"}))
   .toEqual(["09/11/2026","Dana Masuk dari FELICIA JUSTIANI | TUNAI - KAS BESAR SC | SC-IN-000007",10000,"","","Pemasukan"]);
  expect(cashIncomeNumber(5)).toBe("SC-IN-000005");
 });
 it("finds previously appended rows by immutable human-readable ID",()=>{
  const data=[["Keterangan"],["Dana Masuk | SC-IN-000005"],["Dana Masuk | SC-IN-000006"]];
  expect(cashLedgerPositions(data,"SC-IN-000005")).toEqual([2]);
  expect(cashLedgerPositions(data,"SC-IN-000004")).toEqual([]);
 });
 it("will not write bank transfers or guessed saldo, and defaults to disabled",()=>{
  expect(worker).toContain('process.env.NODE_ENV==="production"');
  expect(worker).toContain('process.env.SC_CASH_LEDGER_SYNC_ENABLED==="true"');
  expect(worker).toContain("cash_received_confirmed_at IS NOT NULL");
  expect(worker).toContain("method='Tunai' AND receiving_account='Kas Besar SC'");
  expect(worker).toContain('rows[0].account_type!=="cash"');
  expect(worker).toContain("CASH_SHEET_HEADERS_MISMATCH");
  expect(worker).toContain("CASH_SHEET_READBACK_NOT_UNIQUE");
  expect(worker).toContain("cashLedgerPositions");
  expect(worker).toContain('valueRenderOption:"UNFORMATTED_VALUE"');
  expect(worker).toContain("startScCashLedgerRetryWorker");
  expect(worker).not.toContain("INSERT INTO public.bank_mutations");
  expect(worker).not.toContain("journal_entry");
 });
 it("requires express cash acknowledgement before creation",()=>{
  expect(route).toContain("CONFIRM_CASH_RECEIVED_REQUIRED");
  expect(route).toContain("CASH_CONFIRMATION_ACCOUNT_MISMATCH");
  expect(route).toContain('forCash?"pending":"not_applicable"');
  expect(ui).toContain("cashReceiptConfirmed");
  expect(ui).toContain("Histori Uang Masuk SC");
  expect(ui).toContain("Kas Besar SC");
  expect(ui).toContain("Coba sinkron kas");
  expect(route).toContain("retry-cash-sheet");
 });
});
