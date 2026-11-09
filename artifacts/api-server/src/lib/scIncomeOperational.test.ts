
import {validateIncome,incomeFingerprint,INCOME_TAB,INCOME_HEADERS} from "./scIncomeOperational";
const ok={entryKey:"d1a518c1-e086-45d8-9259-822bc0ba87b3",transactionDate:"2026-11-09",
  sourceName:"Felicia Justiani",senderBank:"BCA",method:"Transfer Bank",
  receivingAccount:"blu by BCA Digital",amount:10000};
describe("SC income operational record safety",()=>{
 it("validates amount and required banking fields",()=>{
   expect(validateIncome(ok).amount).toBe(10000);
   expect(()=>validateIncome({...ok,amount:0})).toThrow("INVALID_AMOUNT");
   expect(()=>validateIncome({...ok,amount:"10.000"})).toThrow("INVALID_AMOUNT");
   expect(()=>validateIncome({...ok,senderBank:""})).toThrow("REQUIRED_FIELD_MISSING");
   expect(()=>validateIncome({...ok,transactionDate:"2026-02-31"})).toThrow("INVALID_DATE");
 });
 it("stable fingerprint prevents repeat records without conflating different amounts",()=>{
   const a=incomeFingerprint(validateIncome(ok));
   expect(a).toBe(incomeFingerprint(validateIncome({...ok,sourceName:" felicia justiani "})));
   expect(a).not.toBe(incomeFingerprint(validateIncome({...ok,amount:20000})));
 });
 it("separates unverified manual receipts from canonical bank mutation tab",()=>{
   expect(INCOME_TAB).toBe("SC Uang Masuk");
   expect(INCOME_HEADERS).toContain("Status Bank");
   expect(INCOME_HEADERS).toContain("SC Entry ID");
 });
});
