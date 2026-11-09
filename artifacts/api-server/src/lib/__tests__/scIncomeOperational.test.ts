import {validateIncome,incomeFingerprint,incomeRowPositions,INCOME_TAB,INCOME_HEADERS} from "../scIncomeOperational";
const example={entryKey:"d1a518c1-e086-45d8-9259-822bc0ba87b3",transactionDate:"2026-11-09",
 sourceName:"Felicia Justiani",senderBank:"BCA",method:"Transfer Bank",receivingAccount:"blu by BCA Digital",amount:10000,bankReference:""};
describe("SC operational income safety and idempotency",()=>{
 it("validates bank fields, date and integer rupiah",()=>{
  expect(validateIncome(example).amount).toBe(10000);
  expect(()=>validateIncome({...example,amount:0})).toThrow("INVALID_AMOUNT");
  expect(()=>validateIncome({...example,amount:"10.000"})).toThrow("INVALID_AMOUNT");
  expect(()=>validateIncome({...example,senderBank:""})).toThrow("REQUIRED_FIELD_MISSING");
  expect(()=>validateIncome({...example,transactionDate:"2026-02-31"})).toThrow("INVALID_DATE");
  expect(()=>validateIncome({...example,entryKey:"not-a-uuid"})).toThrow("INVALID_ENTRY_KEY");
 });
 it("fingerprints exact duplicates, distinguishes amounts and references",()=>{
  const base=incomeFingerprint(validateIncome(example));
  expect(base).toBe(incomeFingerprint(validateIncome({...example,sourceName:" felicia justiani "})));
  expect(base).not.toBe(incomeFingerprint(validateIncome({...example,amount:20000})));
  expect(base).not.toBe(incomeFingerprint(validateIncome({...example,bankReference:"ABC123"})));
 });
 it("deduplicates sheet retries by durable entry key",()=>{
  const rows=[["SC Entry ID"],[example.entryKey,"10000"],["different","10000"]];
  expect(incomeRowPositions(rows,example.entryKey)).toEqual([2]);
  expect(incomeRowPositions([...rows,[example.entryKey,"10000"]],example.entryKey)).toEqual([2,4]);
 });
 it("separates unverified manual rows from bank reconciliation tab",()=>{
  expect(INCOME_TAB).toBe("SC Uang Masuk");
  expect(INCOME_HEADERS).toContain("Status Bank");
  expect(INCOME_HEADERS).toContain("SC Entry ID");
 });
});
